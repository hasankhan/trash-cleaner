import fs from 'fs';
import path from 'path';
import { ProgressReporter } from './progress-reporter.js';
import { Email } from '../client/email-client.js';

const DEFAULT_OUTPUT_FILE = 'trash-cleaner-report.html';

/**
 * A progress reporter that generates an HTML report file.
 */
class HtmlProgressReporter extends ProgressReporter {
    private _outputPath: string;
    private _trashEmails: Email[] = [];
    private _unreadEmailCount: number = 0;
    private _dryRun: boolean = false;

    /**
     * Creates an instance of HtmlProgressReporter.
     */
    constructor(outputPath: string = DEFAULT_OUTPUT_FILE) {
        super();
        this._outputPath = outputPath;
    }

    /**
     * An event that fires when cleaning has started.
     */
    onStart(dryRun: boolean): void {
        this._dryRun = dryRun;
        this._trashEmails = [];
        this._unreadEmailCount = 0;
    }

    /**
     * An event that fires when unread emails are retrieved.
     */
    onUnreadEmailsRetrieved(emails: Email[]): void {
        this._unreadEmailCount = emails.length;
    }

    /**
     * An event that fires when trash emails are identified.
     */
    onTrashEmailsIdentified(emails: Email[]): void {
        this._trashEmails = emails;
    }

    /**
     * An event that fires when cleaning has stopped.
     */
    onStop(): void {
        const html = this._generateHtml();
        fs.writeFileSync(this._outputPath, html, 'utf8');
        const resolvedPath = path.resolve(this._outputPath);
        console.log(`HTML report written to: ${resolvedPath}`);
    }

    /**
     * Generates the full HTML report.
     */
    private _generateHtml(): string {
        const timestamp = new Date().toLocaleString();
        const actionCounts = this._getActionCounts();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trash Cleaner Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 2rem; background: #f5f5f5; }
        .container { max-width: 900px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
        .summary { display: flex; gap: 1rem; margin: 1rem 0; flex-wrap: wrap; }
        .stat { background: #f8f9fa; padding: 1rem; border-radius: 6px; min-width: 150px; }
        .stat .number { font-size: 2rem; font-weight: bold; color: #333; }
        .stat .label { color: #666; font-size: 0.9rem; }
        .action-delete { border-left: 4px solid #dc3545; }
        .action-archive { border-left: 4px solid #ffc107; }
        .action-mark-as-read { border-left: 4px solid #0d6efd; }
        .dry-run-badge { background: #fff3cd; color: #856404; padding: 0.25rem 0.75rem; border-radius: 4px; display: inline-block; margin-bottom: 1rem; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; }
        .action-badge { padding: 0.2rem 0.5rem; border-radius: 3px; font-size: 0.8rem; font-weight: 500; }
        .badge-delete { background: #f8d7da; color: #721c24; }
        .badge-archive { background: #fff3cd; color: #856404; }
        .badge-mark-as-read { background: #cce5ff; color: #004085; }
        .timestamp { color: #999; font-size: 0.85rem; }
        .empty { color: #666; font-style: italic; padding: 2rem; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🗑️ Trash Cleaner Report</h1>
        <p class="timestamp">Generated: ${this._escapeHtml(timestamp)}</p>
        ${this._dryRun ? '<span class="dry-run-badge">⚠️ Dry-run mode — no actions were performed</span>' : ''}
        
        <div class="summary">
            <div class="stat">
                <div class="number">${this._unreadEmailCount}</div>
                <div class="label">Unread emails</div>
            </div>
            <div class="stat">
                <div class="number">${this._trashEmails.length}</div>
                <div class="label">Trash identified</div>
            </div>
            ${this._renderActionStats(actionCounts)}
        </div>

        ${this._trashEmails.length > 0 ? this._renderEmailTable() : '<p class="empty">No trash emails found.</p>'}
    </div>
</body>
</html>`;
    }

    /**
     * Gets action counts from trash emails.
     */
    private _getActionCounts(): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const email of this._trashEmails) {
            const action = email._action || 'delete';
            counts[action] = (counts[action] || 0) + 1;
        }
        return counts;
    }

    /**
     * Renders action stat cards.
     */
    private _renderActionStats(actionCounts: Record<string, number>): string {
        return Object.entries(actionCounts).map(([action, count]) =>
            `<div class="stat action-${action}">
                <div class="number">${count}</div>
                <div class="label">${this._actionLabel(action)}</div>
            </div>`
        ).join('\n            ');
    }

    /**
     * Renders the email details table.
     */
    private _renderEmailTable(): string {
        const rows = this._trashEmails.map(email => {
            const action = email._action || 'delete';
            const rule = email._rule ? this._escapeHtml(email._rule) : '';
            return `<tr>
                <td><span class="action-badge badge-${action}">${action}</span></td>
                <td>${rule}</td>
                <td>${this._escapeHtml(email.from)}</td>
                <td>${this._escapeHtml(email.subject)}</td>
                <td>${this._escapeHtml(email.labels.join(', '))}</td>
            </tr>`;
        }).join('\n');

        return `<table>
            <thead>
                <tr><th>Action</th><th>Rule</th><th>From</th><th>Subject</th><th>Labels</th></tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    /**
     * Returns a human-readable action label.
     */
    private _actionLabel(action: string): string {
        switch (action) {
            case 'delete': return 'Deleted';
            case 'archive': return 'Archived';
            case 'mark-as-read': return 'Marked as read';
            default: return action;
        }
    }

    /**
     * Escapes HTML special characters.
     */
    private _escapeHtml(str: string): string {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

export { HtmlProgressReporter };
