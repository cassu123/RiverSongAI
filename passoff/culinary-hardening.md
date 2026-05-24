### 1. Summary
I will execute a Phase 4 Hardening Pass on CulinaryPage to replace brittle JSON editors with dynamic forms, secure modal accessibility, tune image latency, standardize API methods, enforce typography for selection smoothness, and expand test coverage.

### 2. Audit / Gap Analysis
- **Raw JSON textareas**: Editing recipes requires manually typing JSON, which is error-prone.
- **Modal Accessibility**: The newly centered `RecipeDetailModal` lacks an `Escape` key listener and a focus trap.
- **Close Button Overlap**: The header buttons in the modal don't have adequate margins, touching the scrollbar or edges.
- **Image Latency**: The recipe cards use the global `animate-page-in` class which triggers a sluggish (`--rs-motion-slow`) blur filter transition.
- **API Consistency**: Wrapper specifies `del` instead of standard `delete`.
- **Text Selection Jitter**: Execution sequences use `line-height: 1.6` which can cause browser highlight jumping.
- **Testing**: `CulinaryPage.test.jsx` lacks mutation assertions.

### 3. Data Contract
No backend schema changes are required. The frontend will map edits strictly to the existing schema shape:
```typescript
interface RecipeUpdate {
  title: string;
  meal_type: string;
  primary_protein?: string | null;
  servings: number;
  ingredients: Array<{ name: string; qty: string; unit: string }>;
  steps: string[];
}
// `VoteRequest` payload to /api/culinary/dinner/{id}/vote
interface VoteRequest { vote: "yes" | "no"; }
```

### 4. Implementation Plan
- **Pod A: API & UI Cleanup**
  - Rename `del` to `delete` in `useApi` and update all invocations (`api.delete('/recipes/...')`, etc.).
  - Update `line-height: 1.7` in the Execution Sequence renderer and step textareas.
- **Pod B: Image Performance Tuning**
  - Inject `animationDuration: '400ms'` into the inline styles of the `.rs-card.animate-page-in` elements rendering the recipe covers, speeding up the blur decay while preserving the effect.
- **Pod C: Modal Hardening**
  - Add a `useRef(null)` and `useEffect` block in `RecipeDetailModal` to handle `Escape` closure and a basic keyboard `Tab` focus trap.
  - Apply explicit top/right padding (`padding: '8px 8px 24px 8px'`) to the modal's header flexbox to prevent button overlap.
- **Pod D: Dynamic Forms**
  - Delete JSON textareas in `RecipeDetailModal`.
  - Implement array map renderers for `edited.ingredients` with individual inputs (`qty`, `unit`, `name`) and an "X" remove button.
  - Implement array map renderer for `edited.steps` with `textarea` inputs and an "X" remove button.
  - Add "Add Provision" and "Add Step" buttons that push empty templates to local state.
- **Pod E: Test Coverage**
  - Add `fireEvent` / `userEvent` flows to `CulinaryPage.test.jsx` that simulate dropdown filtering, clicking the Edit button/submitting a save, and voting "yes" on a proposal.

### 5. File Map
- `frontend/src/pages/CulinaryPage.jsx` — Update — Chris (Primary Frontend)
- `frontend/src/pages/CulinaryPage.test.jsx` — Update — Chris (Tests)

### 6. Absolute Constraints
- No new NPM packages (Redux, Zustand, React-Focus-Lock, etc).
- Do not touch `api/routes/culinary.py`, `Sheet.jsx`, or any SQLAlchemy models.

### 7. Acceptance Criteria
- [ ] Raw JSON textareas are eliminated; dynamic add/remove forms exist for ingredients and steps.
- [ ] Modal traps focus and closes on Escape.
- [ ] Close button group no longer overlaps the modal edge (visual padding verified).
- [ ] Recipe card image blur transition is snappy (< 500ms perceived delay).
- [ ] `api.del` is purged from `CulinaryPage.jsx` and replaced with `api.delete`.
- [ ] Step text selection is smooth (line-height ≥ 1.7 on all text blocks).
- [ ] Tests cover filter behavior, edit submission, and vote posting.