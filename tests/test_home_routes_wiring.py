"""The Home routes are wired the way FastAPI expects.

This file exists because of a bug the rest of the suite could not see. The
module had `from __future__ import annotations` but never imported `Request`,
so the annotation stayed a string FastAPI could not resolve. It did not raise:
FastAPI quietly demoted `request` to a *required query parameter*, and three
endpoints returned 422 forever while the server started clean and every unit
test passed.

Testing the engine functions directly will never catch that. Testing the
wiring will.
"""

from __future__ import annotations

import pytest

fastapi = pytest.importorskip("fastapi")


@pytest.fixture(scope="module")
def home_router():
    import api.routes.home as home
    return home.router


def test_no_route_takes_request_as_a_query_parameter(home_router):
    """`request` in query_params means the annotation did not resolve."""
    offenders = []
    for route in home_router.routes:
        dependant = getattr(route, "dependant", None)
        if not dependant:
            continue
        for q in dependant.query_params:
            if q.name in ("request", "response"):
                offenders.append(f"{route.path} -> {q.name}")
    assert not offenders, (
        "FastAPI could not resolve these annotations and turned them into "
        f"query parameters: {offenders}")


def test_routes_that_need_the_request_object_receive_it(home_router):
    """Every endpoint whose signature names `request` must get the real one."""
    import inspect
    missing = []
    for route in home_router.routes:
        endpoint = getattr(route, "endpoint", None)
        dependant = getattr(route, "dependant", None)
        if not endpoint or not dependant:
            continue
        if "request" in inspect.signature(endpoint).parameters:
            if dependant.request_param_name != "request":
                missing.append(route.path)
    assert not missing, f"request is not injected for: {missing}"


def test_every_annotation_in_the_module_resolves(home_router):
    """A missing import anywhere in the module surfaces the same way."""
    import typing
    import api.routes.home as home
    unresolved = []
    for route in home_router.routes:
        endpoint = getattr(route, "endpoint", None)
        if not endpoint:
            continue
        try:
            typing.get_type_hints(endpoint, vars(home))
        except NameError as e:
            unresolved.append(f"{route.path}: {e}")
    assert not unresolved, unresolved


def test_the_live_stream_does_not_accept_a_token_in_the_url(home_router):
    """A bearer token in a URL lands in access logs, proxy logs and history."""
    for route in home_router.routes:
        if getattr(route, "path", "").endswith("/stream"):
            names = [q.name for q in route.dependant.query_params]
            assert "token" not in names, (
                "the event stream takes a token query parameter again")
            return
    pytest.fail("no /stream route found")
