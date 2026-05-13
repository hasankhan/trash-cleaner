import sinon from 'sinon';
import { Email } from '../../lib/client/email-client.js';
import { TrashCleaner, TrashCleanerFactory } from '../../lib/trash-cleaner.js';
import { ProgressReporter } from '../../lib/reporter/progress-reporter.js';

/**
 * Integration tests that exercise the full flow with mocked email clients.
 */
describe('Integration: Full cleanup flow', () => {
    let client: any, reporter: ProgressReporter;

    before(() => {
        sinon.stub(console, 'log');
    });

    after(() => {
        (console.log as sinon.SinonStub).restore();
    });

    beforeEach(() => {
        client = {
            getUnreadEmails: sinon.stub(),
            deleteEmails: sinon.stub().resolves(),
            archiveEmails: sinon.stub().resolves(),
            markAsReadEmails: sinon.stub().resolves()
        };
        reporter = new ProgressReporter();
    });

    it('processes mixed actions correctly across multiple emails', async () => {
        const spamEmail = new Email();
        spamEmail.id = '1';
        spamEmail.from = 'spammer@evil.com';
        spamEmail.subject = 'Win a casino prize!';
        spamEmail.body = 'Click here to win big at the casino';
        spamEmail.snippet = 'Click here to win big';
        spamEmail.labels = ['spam'];

        const newsletter = new Email();
        newsletter.id = '2';
        newsletter.from = 'news@company.com';
        newsletter.subject = 'Weekly newsletter digest';
        newsletter.body = 'Here is your weekly newsletter';
        newsletter.snippet = 'Here is your weekly';
        newsletter.labels = ['inbox'];

        const notification = new Email();
        notification.id = '3';
        notification.from = 'noreply@service.com';
        notification.subject = 'New notification received';
        notification.body = 'You have a new notification';
        notification.snippet = 'You have a new';
        notification.labels = ['inbox'];

        const safeEmail = new Email();
        safeEmail.id = '4';
        safeEmail.from = 'friend@example.com';
        safeEmail.subject = 'Hello!';
        safeEmail.body = 'How are you?';
        safeEmail.snippet = 'How are you?';
        safeEmail.labels = ['inbox'];

        client.getUnreadEmails.resolves([spamEmail, newsletter, notification, safeEmail]);

        const keywords = [
            { value: 'casino', fields: ['*'], labels: ['spam'], action: 'delete' },
            { value: 'newsletter', fields: ['subject'], labels: ['inbox'], action: 'archive' },
            { value: 'notification', fields: ['subject'], labels: ['inbox'], action: 'mark-as-read' }
        ];

        const cleaner = new TrashCleaner(client, keywords, reporter);
        await cleaner.cleanTrash(false);

        sinon.assert.calledOnce(client.deleteEmails);
        sinon.assert.calledWith(client.deleteEmails, [spamEmail]);
        sinon.assert.calledOnce(client.archiveEmails);
        sinon.assert.calledWith(client.archiveEmails, [newsletter]);
        sinon.assert.calledOnce(client.markAsReadEmails);
        sinon.assert.calledWith(client.markAsReadEmails, [notification]);
    });

    it('respects allowlist even when rules match', async () => {
        const email = new Email();
        email.id = '1';
        email.from = 'boss@trusted.com';
        email.subject = 'Free casino bonus';
        email.body = 'casino offer';
        email.snippet = 'casino offer';
        email.labels = ['inbox'];

        client.getUnreadEmails.resolves([email]);

        const keywords = [
            { value: 'casino', fields: ['*'], labels: ['*'], action: 'delete' }
        ];
        const allowlist = ['@trusted\\.com'];

        const cleaner = new TrashCleaner(client, keywords, reporter, allowlist);
        await cleaner.cleanTrash(false);

        sinon.assert.notCalled(client.deleteEmails);
    });

    it('dry-run mode identifies but does not act on emails', async () => {
        const email = new Email();
        email.id = '1';
        email.from = 'spammer@test.com';
        email.subject = 'Buy now';
        email.body = 'casino win';
        email.snippet = 'casino';
        email.labels = ['spam'];

        client.getUnreadEmails.resolves([email]);

        const keywords = [
            { value: 'casino', fields: ['*'], labels: ['*'], action: 'delete' }
        ];

        const cleaner = new TrashCleaner(client, keywords, reporter);
        await cleaner.cleanTrash(true /* dryRun */);

        sinon.assert.notCalled(client.deleteEmails);
        sinon.assert.notCalled(client.archiveEmails);
        sinon.assert.notCalled(client.markAsReadEmails);
    });

    it('handles empty mailbox gracefully', async () => {
        client.getUnreadEmails.resolves([]);

        const keywords = [
            { value: 'spam', fields: ['*'], labels: ['*'] }
        ];

        const cleaner = new TrashCleaner(client, keywords, reporter);
        await cleaner.cleanTrash(false);

        sinon.assert.notCalled(client.deleteEmails);
    });

    it('handles no matching emails gracefully', async () => {
        const email = new Email();
        email.id = '1';
        email.from = 'friend@example.com';
        email.subject = 'Hello';
        email.body = 'Hi there';
        email.snippet = 'Hi there';
        email.labels = ['inbox'];

        client.getUnreadEmails.resolves([email]);

        const keywords = [
            { value: 'casino', fields: ['*'], labels: ['spam'] }
        ];

        const cleaner = new TrashCleaner(client, keywords, reporter);
        await cleaner.cleanTrash(false);

        sinon.assert.notCalled(client.deleteEmails);
    });
});

describe('Integration: TrashCleanerFactory full flow', () => {
    before(() => {
        sinon.stub(console, 'log');
    });

    after(() => {
        (console.log as sinon.SinonStub).restore();
    });

    it('creates cleaner and processes emails end-to-end', async () => {
        const configStore: any = {
            getJson: sinon.stub(),
            putJson: sinon.stub().resolves()
        };
        configStore.getJson.withArgs('keywords.json').resolves([
            { value: 'spam', fields: '*', labels: '*', action: 'delete' },
            { value: 'promo', fields: 'subject', labels: 'inbox', action: 'archive' }
        ]);
        configStore.getJson.withArgs('allowlist.json').resolves(['vip@company\\.com']);
        configStore.getJson.withArgs('seen.json').resolves(null);
        configStore.getJson.withArgs('llm-providers.json').resolves(null);

        const email1 = new Email();
        email1.id = '1';
        email1.from = 'spammer@evil.com';
        email1.body = 'spam content';
        email1.subject = 'spam';
        email1.snippet = 'spam';
        email1.labels = ['junk'];

        const email2 = new Email();
        email2.id = '2';
        email2.from = 'store@shop.com';
        email2.body = 'sale';
        email2.subject = 'Weekly promo deals';
        email2.snippet = 'promo';
        email2.labels = ['inbox'];

        const email3 = new Email();
        email3.id = '3';
        email3.from = 'vip@company.com';
        email3.body = 'spam content';
        email3.subject = 'Meeting spam';
        email3.snippet = 'spam';
        email3.labels = ['inbox'];

        const client = {
            getUnreadEmails: sinon.stub().resolves([email1, email2, email3]),
            deleteEmails: sinon.stub().resolves(),
            archiveEmails: sinon.stub().resolves(),
            markAsReadEmails: sinon.stub().resolves()
        };

        const factory = new TrashCleanerFactory(configStore, client, false);
        const cleaner = await factory.getInstance();
        await cleaner.cleanTrash(false);

        // email1 matches 'spam' → delete
        sinon.assert.calledWith(client.deleteEmails, [email1]);
        // email2 matches 'promo' in subject → archive
        sinon.assert.calledWith(client.archiveEmails, [email2]);
        // email3 matches 'spam' but sender is allowlisted → no action
        sinon.assert.calledOnce(client.deleteEmails);
        sinon.assert.calledOnce(client.archiveEmails);
    });
});
