const assert = require('assert');
const sinon = require('sinon');
const {Email} = require('../email-client');
const {TrashCleaner} = require('../trash-cleaner');

describe('TrashCleaner', () => {
  describe('cleanTrash', () => {
    it('finds spam with diacritics', async () => {
      let email = new Email();
      email.body = 'Ápplé';
      email.labels = ["spam"];
      let client = {
        getUnreadEmails: sinon.stub().returns([email]),
        deleteEmails: sinon.spy()
      }
      let cleaner = new TrashCleaner(client, [{
        val: "apple", labels: ["spam"]
      }])
      
      await cleaner.cleanTrash();

      assert(client.deleteEmails.calledWith([email]));
    });
  });
});