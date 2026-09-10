"""
tests/test_internal_imports_resolve.py

Every internal import must point at a module that exists.

`compileall` proves a file parses; it does not prove `from core.vortex.hub
import x` resolves. A package move that misses a call site therefore passes
syntax checks and only fails when that code path first runs — which, for a
lazily imported branch, can be in production. This walks the AST of every
tracked module and resolves each first-party import against the tree, so a
half-finished move fails here instead.

Third-party imports are ignored: this is about our own layout, not about
which optional dependencies happen to be installed.
"""

import ast
import pathlib

import pytest


ROOT = pathlib.Path(__file__).resolve().parents[1]
FIRST_PARTY = {
    "core", "api", "daemons", "providers", "config",
    "clients", "domains", "db",
}
SKIP_DIRS = {"node_modules", "venv", ".venv", "__pycache__", ".git", "dist", "build"}


def _python_files():
    for path in ROOT.rglob("*.py"):
        if SKIP_DIRS & set(path.parts):
            continue
        yield path


def _resolves(dotted: str) -> bool:
    """True if `dotted` names a real module or package in the tree."""
    base = ROOT / dotted.replace(".", "/")
    return base.with_suffix(".py").exists() or (base / "__init__.py").exists()


def _first_party_imports(path: pathlib.Path):
    """(lineno, module) for every absolute first-party import in the file."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
    except SyntaxError:
        return
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level or not node.module:
                continue  # relative import; resolved by position, not path
            if node.module.split(".")[0] in FIRST_PARTY:
                yield node.lineno, node.module
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in FIRST_PARTY:
                    yield node.lineno, alias.name


@pytest.mark.parametrize(
    "path", sorted(_python_files()), ids=lambda p: str(p.relative_to(ROOT))
)
def test_first_party_imports_point_at_real_modules(path):
    broken = [
        f"{path.relative_to(ROOT)}:{lineno} -> {module}"
        for lineno, module in _first_party_imports(path)
        if not _resolves(module)
    ]
    assert not broken, "imports pointing at modules that do not exist:\n  " + "\n  ".join(broken)


def test_the_moved_packages_are_packages_not_loose_modules():
    """core/vortex, core/tools, and domains/* are packages; flat modules are gone."""
    for pkg in ("core/vortex", "core/tools", "domains", "domains/culinary", "domains/inventory", "domains/vehicles", "domains/commercial_inventory"):
        assert (ROOT / pkg / "__init__.py").exists(), f"{pkg} is not a package"
        assert not (ROOT / f"{pkg}.py").exists(), f"{pkg}.py still shadows {pkg}/"

    for root_dom in ("culinary", "inventory", "vehicles", "commercial_inventory"):
        assert not (ROOT / root_dom).exists(), f"legacy root folder {root_dom}/ still exists"

    stale = sorted(
        p.name for p in (ROOT / "core").glob("vortex_*.py")
    ) + sorted(p.name for p in (ROOT / "core").glob("tools_*.py"))
    assert not stale, f"pre-move modules left behind in core/: {stale}"
