# AGENTS

## Build & Test

```bash
npm install
npm test                              # runs: c8 mocha --recursive
npm run lint                          # runs: eslint .
npx mocha test/trash-cleaner.spec.js  # single test file
npx mocha --grep "finds spam"         # single test by name
npm install -g .                      # install globally for manual testing
```

After completing a task, run `npm install -g .` so the latest changes are available globally for manual testing.

## Architecture

This is a Node.js CLI tool that deletes, archives, or marks-as-read trash/spam emails from Gmail and Outlook based on configurable keyword rules.

**Flow:** `bin/trash-cleaner` → `index.js` → `Cli` → `EmailClient` + `TrashCleaner`

The codebase uses a **factory pattern** throughout. `TrashCleanerFactory`, `GmailClientFactory`, and `OutlookClientFactory` each expose a `getInstance()` method that handles async setup (reading config, OAuth) before returning the usable instance.

**Key abstractions:**
- `EmailClient` (base) → `GmailClient` / `OutlookClient` — fetch unread emails + delete/archive/mark-as-read
- `ConfigStore` (base) → `FileSystemConfigStore` — read/write JSON config files from `config/`
- `ProgressReporter` (base) → `ConsoleProgressReporter` — event-based progress reporting with `ora` spinner
- `TrashRule` (base) → `KeywordTrashRule` — regex-based matching against email fields and labels

**Trash matching:** Keywords from `config/keywords.json` become `KeywordTrashRule` objects. Each rule has a regex `value`, target `fields` (from/subject/snippet/body or `*` for all), `labels` to scope matching, and an `action` (delete/archive/mark-as-read). Emails are normalized with `diacriticless` before matching.

**Multi-account:** The `--account` flag selects which credential/token files to use. Default account uses standard file names; named accounts use suffixed files (e.g., `gmail.credentials.work.json`).

**Config validation:** `keywords.json` is validated at load time with clear error messages including the entry index.

## Conventions

- **Inheritance over interfaces:** Base classes (`EmailClient`, `ConfigStore`, `ProgressReporter`, `TrashRule`) define the contract with empty/default method implementations. Subclasses override them.
- **JSDoc on all public methods:** Follow the existing JSDoc style with `@param` and `@returns` tags.
- **Test structure mirrors source:** `test/` mirrors `lib/` directory layout. Tests use Mocha + Chai (`assert` style) + Sinon for stubs/mocks.
- **Config files live in `config/`:** Sample files use `.sample` suffix. Actual credential/token files are gitignored.
- **Strict equality:** Use `===` instead of `==`; ESLint enforces this.
- **Prefix unused params with `_`:** Base class method parameters that are unused use the `_` prefix convention.
