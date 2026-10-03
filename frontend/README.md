# Winstore ERP — Frontend

React + Vite + Tailwind CSS frontend for Winstore ERP.

See the repository root `README.md` for setup and run instructions.

Billing includes Budgets (organization-wide plans) and Cash Register (branch
tills, opening balances, money in/out, and transaction history). Viewing these
pages requires the matching `budgets:view` or `cash_register:view` grant;
creating a budget, register, or movement requires the matching `create` grant.
The existing `manage` grants cover both. Register creation requires a branch.

Run the focused permission and financial-input checks with `npm test`.
