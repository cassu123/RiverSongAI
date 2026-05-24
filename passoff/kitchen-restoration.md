### 1. Summary
I am restoring the Kitchen module's core functionality, reconnecting the frontend to the intact backend schemas and endpoints, and replacing aesthetic placeholders with functional UI without modifying `Sheet.jsx` or the backend.

### 2. Gap Analysis
- **Module Header**: Currently reads "Gourmet Logistics", needs to be "Kitchen".
- **Stock & Hardware**: Hardware reads from `localStorage`. Stockroom needs confirmation it renders backend data properly.
- **Recipe Detail Modal**: Uses the globally bottom-anchored `Sheet`. Needs a centered, contextual `RecipeDetailModal`.
- **Recipe Edit**: Missing from UI. Needs a form matching the `cul_recipes` schema and wired to `PUT /api/culinary/recipes/{id}`.
- **Prep Deck (Staging)**: Missing from UI. Needs a tab to display active prep sessions via `/api/culinary/prep`.
- **Vote/Veto (Dinner Proposal)**: Missing from UI. Needs a tab to display proposals and allow yes/no voting via `/api/culinary/dinner/{id}/vote`.
- **Ranking**: `StarRating` is read-only. Needs an `onChange` handler to persist ratings via `PATCH /api/culinary/recipes/{id}/rate`.
- **Filters**: Category and protein filters are missing from the library tab.

### 3. Data Contracts
```typescript
interface Recipe {
  id: string;
  title: string;
  meal_type: string;
  primary_protein?: string;
  servings: number;
  image_url?: string;
  rating?: number;
  ingredients: Array<{ name: string; qty: string; unit: string }>;
  steps: string[];
  equipment_needed: string[];
}

interface StockroomItem {
  id: string;
  name: string;
  brand?: string;
  state: string;
  quantity: number;
  min_quantity: number;
}

interface HardwareItem {
  id: string;
  equipment_type: string;
  label: string;
  make?: string;
  model?: string;
}

interface PrepSession {
  id: string;
  label?: string;
  is_active: boolean;
  recipes: Array<{
    entry_id: string;
    recipe_id: string;
    recipe_title: string;
    servings_target?: number;
    scaled_ingredients?: any[];
  }>;
}

interface DinnerProposal {
  id: string;
  recipe_id: string;
  recipe: Recipe;
  proposed_by: string;
  votes_yes: string[];
  votes_no: string[];
  status: string;
}
```

### 4. Restoration Plan
- **Pod A: Rename & Filters**
  - Update `h1` from "Gourmet Logistics" to "Kitchen".
  - Add category and protein dropdowns to the search bar in the "library" tab. Update filtering logic.
- **Pod B: Stock & Hardware API reconnection**
  - Update `fetchData` in `CulinaryPage.jsx` to fetch equipment from `/api/culinary/household/equipment` instead of `localStorage`.
- **Pod C: Recipe Detail Modal (centered) & Edit Form**
  - Create a new `RecipeDetailModal` component with a centered fixed overlay (`fixed inset-0 flex items-center justify-center ...`).
  - Add an `isEditing` state. When true, display an edit form for title, meal_type, primary_protein, servings, ingredients, and steps.
  - Wire save button to `api.put('/recipes/{id}', data)`.
  - Replace `<Sheet>` usage with `<RecipeDetailModal>` in `CulinaryPage.jsx`.
- **Pod D: Prep Deck (Staging) restoration**
  - Add a "PREP" tab.
  - Fetch active prep session via `/api/culinary/prep` and its staging data via `/api/culinary/prep/{id}/staging`.
  - Render the active session and its recipes/ingredients.
- **Pod E: Vote / Veto panel reconstruction**
  - Add a "DINNER" tab.
  - Fetch proposals via `/api/culinary/dinner`.
  - Render proposals with "Yes" and "No (Veto)" buttons, wired to `/api/culinary/dinner/{id}/vote`.
- **Pod F: Star Rating fix & persistence**
  - Update `StarRating` component to accept an `onChange` prop and use interactive elements (e.g. `<button>`).
  - When rating changes, call `api.patch('/recipes/{id}/rate', { rating })` and update local state.

### 5. File Map
- `frontend/src/pages/CulinaryPage.jsx` — Update — Restores all UI components, connects APIs, replaces Sheet modal, and integrates edits/votes.

### 6. Absolute Constraints
- `[VERIFIED WORKING — DO NOT TOUCH]`: `api/routes/culinary.py`, `cul_recipes`, `cul_stockroom`, `cul_kitchen_equipment`, `cul_active_vote`, `cul_prep_sessions`, and `frontend/src/chrome/Sheet.jsx`.
- No Redux, Zustand, or new global state libraries.
- Standard React 18 patterns only (`useState`, `useEffect`).

### 7. Acceptance Criteria
- [ ] Header reads "Kitchen".
- [ ] Stock and Hardware populated from backend API instead of `localStorage`.
- [ ] Recipe detail renders in a centered / contextual modal (not the bottom `Sheet`).
- [ ] Recipe can be edited inline and persisted via the existing backend `PUT`.
- [ ] Prep Deck lists and manages staging sessions against the backend.
- [ ] Vote / Veto panel is functional and posts votes to the backend.
- [ ] Star rating is interactive and persists its value.
- [ ] Category and protein filters filter the recipe list.
- [ ] Every restored feature has a corresponding test file or test block (unit or integration).
