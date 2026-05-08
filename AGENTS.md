# AGENTS

## Build & Test

```bash
npm install
npm test                              # runs: nyc mocha --recursive
npx mocha test/trash-cleaner.spec.js  # single test file
npx mocha --grep "finds spam"         # single test by name
```

## Architecture

This is a Node.js CLI tool that deletes trash/spam emails from Gmail and Outlook based on configurable keyword rules.

**Flow:** `bin/trash-cleaner` → `index.js` → `Cli` → `EmailClient` + `TrashCleaner`

The codebase uses a **factory pattern** throughout. `TrashCleanerFactory`, `GmailClientFactory`, and `OutlookClientFactory` each expose a `getInstance()` method that handles async setup (reading config, OAuth) before returning the usable instance.

**Key abstractions:**
- `EmailClient` (base) → `GmailClient` / `OutlookClient` — fetch unread emails + delete
- `ConfigStore` (base) → `FileSystemConfigStore` — read/write JSON config files from `config/`
- `ProgressReporter` (base) → `ConsoleProgressReporter` — event-based progress reporting with `ora` spinner
- `TrashRule` (base) → `KeywordTrashRule` — regex-based matching against email fields and labels

**Trash matching:** Keywords from `config/keywords.json` become `KeywordTrashRule` objects. Each rule has a regex `value`, target `fields` (from/subject/snippet/body or `*` for all), and `labels` to scope matching. Emails are normalized with `diacriticless` before matching.

## Conventions

- **Inheritance over interfaces:** Base classes (`EmailClient`, `ConfigStore`, `ProgressReporter`, `TrashRule`) define the contract with empty/default method implementations. Subclasses override them.
- **JSDoc on all public methods:** Follow the existing JSDoc style with `@param` and `@returns` tags.
- **Test structure mirrors source:** `test/` mirrors `lib/` directory layout. Tests use Mocha + Chai (`assert` style) + Sinon for stubs/mocks.
- **Config files live in `config/`:** Sample files use `.sample` suffix. Actual credential/token files are gitignored.
