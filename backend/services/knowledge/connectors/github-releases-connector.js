'use strict';

const crypto = require('crypto');

function hashContent(content) {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex');
}

function buildReleaseContent(release, repository) {
  const title = release.name || release.tag_name || 'Untitled release';
  const body = typeof release.body === 'string' ? release.body.trim() : '';

  return [
    `# ${title}`,
    '',
    `Repository: ${repository}`,
    `Tag: ${release.tag_name || ''}`,
    `Published: ${release.published_at || release.created_at || ''}`,
    `URL: ${release.html_url || ''}`,
    '',
    body,
  ].join('\n').trim();
}

function normalizeRelease(release, config) {
  const repository = `${config.owner}/${config.repository}`;
  const content = buildReleaseContent(release, repository);
  const externalId = String(release.id);
  const sourceUrl = release.html_url;

  return {
    externalId,
    sourceId: config.id,
    source: 'GitHub',
    sourceType: config.sourceType,
    repository,
    sourceUrl,
    title: release.name || release.tag_name || `Release ${externalId}`,
    tagName: release.tag_name || null,
    publishedAt: release.published_at || release.created_at || null,
    updatedAt: release.updated_at || null,
    content,
    contentHash: hashContent(content),
    rawMetadata: {
      draft: release.draft === true,
      prerelease: release.prerelease === true,
      author: release.author && release.author.login ? release.author.login : null,
    },
  };
}

class GitHubReleasesConnector {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.fetch = dependencies.fetch || global.fetch;
  }

  async fetchReleases() {
    if (!this.config || !this.config.owner || !this.config.repository) {
      throw new Error('GitHub Releases source requires owner and repository.');
    }

    if (typeof this.fetch !== 'function') {
      throw new Error('Fetch API is not available.');
    }

    const maxReleases = Math.min(Math.max(Number(this.config.maxReleases) || 10, 1), 100);
    const endpoint = `${this.config.apiBaseUrl}/repos/${this.config.owner}/${this.config.repository}/releases?per_page=${maxReleases}`;
    const response = await this.fetch(endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'OXKIO-Universal-Knowledge-Supervisor/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const error = new Error(`GitHub Releases request failed with status ${response.status}.`);
      error.code = 'github_releases_request_failed';
      error.status = response.status;
      throw error;
    }

    const releases = await response.json();

    if (!Array.isArray(releases)) {
      throw new Error('GitHub Releases response must be an array.');
    }

    return releases.map((release) => normalizeRelease(release, this.config));
  }
}

module.exports = {
  GitHubReleasesConnector,
  buildReleaseContent,
  hashContent,
  normalizeRelease,
};
