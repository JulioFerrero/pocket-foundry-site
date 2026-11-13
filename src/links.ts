/** Where the download and source buttons go. */
const REPO = 'https://github.com/JulioFerrero/pocket-foundry';
export const links = {
  repo: REPO,
  releases: `${REPO}/releases`,
  issues: `${REPO}/issues`,
  licence: `${REPO}/blob/main/LICENSE`,
  obtainium:
    'https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22app.pocketfoundry%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2FJulioFerrero%2Fpocket-foundry%22%2C%22author%22%3A%22JulioFerrero%22%2C%22name%22%3A%22Pocket%20Foundry%22%7D',
  issue: (number: number) => `${REPO}/issues/${number}`,
};
