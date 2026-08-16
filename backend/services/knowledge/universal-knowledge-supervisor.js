'use strict';

const ApprovalQueue = require('../../core/approvalQueue');
const knowledgeSources = require('../../config/knowledgeSources');
const { GitHubReleasesConnector } = require('./connectors/github-releases-connector');
const { evaluateSourceQuality } = require('./source-quality-evaluator');
const { KnowledgeChangeDetector } = require('./knowledge-change-detector');
const { processKnowledgeDocument } = require('./knowledge-pipeline');

function candidateToDocument(candidate) {
  return {
    name: `${candidate.repository.replace('/', '-')}-${candidate.tagName || candidate.externalId}.md`,
    type: 'file',
    extension: '.md',
    path: candidate.sourceUrl,
    source: candidate.repository,
    sourceType: candidate.sourceType,
    sourceUrl: candidate.sourceUrl,
    externalId: candidate.externalId,
    content: candidate.content,
    contentHash: candidate.contentHash,
    technical: {
      createdAt: candidate.publishedAt,
      modifiedAt: candidate.updatedAt || candidate.publishedAt,
    },
  };
}

class UniversalKnowledgeSupervisor {
  constructor(options = {}) {
    this.sourceConfig = options.sourceConfig || knowledgeSources.githubReleases;
    this.approvalQueue = options.approvalQueue || new ApprovalQueue();
    this.connector = options.connector || new GitHubReleasesConnector(
      this.sourceConfig,
      { fetch: options.fetch },
    );
    this.qualityEvaluator = options.qualityEvaluator || evaluateSourceQuality;
    this.changeDetector = options.changeDetector || new KnowledgeChangeDetector(options.statePath);
    this.processDocument = options.processDocument || processKnowledgeDocument;
  }

  async discover() {
    const candidates = await this.connector.fetchReleases();
    const result = {
      sourceId: this.sourceConfig.id,
      repository: `${this.sourceConfig.owner}/${this.sourceConfig.repository}`,
      fetched: candidates.length,
      proposed: 0,
      unchanged: 0,
      rejected: 0,
      proposals: [],
      rejections: [],
    };

    for (const candidate of candidates) {
      const quality = this.qualityEvaluator(candidate, this.sourceConfig);

      if (!quality.approved) {
        result.rejected += 1;
        result.rejections.push({ externalId: candidate.externalId, quality });
        continue;
      }

      const change = this.changeDetector.detect(candidate);

      if (!change.changed) {
        result.unchanged += 1;
        continue;
      }

      const approval = await this.approvalQueue.add({
        type: 'knowledge_ingestion',
        action: 'ingest_github_release',
        title: `Incorporar release ${candidate.tagName || candidate.externalId} a la Biblioteca OXKIO`,
        summary: candidate.title,
        recommendation: 'Revisar y aprobar la incorporación al Knowledge Store oficial.',
        requiresApproval: true,
      }, {
        source: 'github-releases',
        candidate,
        quality,
        change: {
          changeType: change.changeType,
          previousHash: change.previous ? change.previous.contentHash : null,
        },
      });

      this.changeDetector.record(candidate, 'pending-approval', {
        approvalId: approval.id,
        changeType: change.changeType,
      });
      result.proposed += 1;
      result.proposals.push({
        approvalId: approval.id,
        externalId: candidate.externalId,
        title: candidate.title,
        changeType: change.changeType,
      });
    }

    return result;
  }

  // FASE A2: ya no muta `approval.item.execution` ni llama a
  // `approvalQueue.save()` directamente (ese bypass saltaba CAS/version/
  // status por completo). La ingesta de conocimiento se trata ahora como
  // cualquier otra ejecución: claim -> trabajo real -> complete/fail, con el
  // mismo begin/completeExecution/failExecution que usa execution-service.js
  // para Gmail. El item queda en estado `executed`, visible como tal en
  // listHistory/getHistory, en vez de quedarse indefinidamente en `approved`
  // con una anotación invisible fuera de la serialización JSON.
  async approve(approvalId) {
    const pending = (await this.approvalQueue.listPending()).find((item) => item.id === approvalId);

    if (!pending) return { ok: false, error: 'Knowledge approval not found.' };
    if (!pending.proposal || pending.proposal.action !== 'ingest_github_release') {
      return { ok: false, error: 'Approval is not a GitHub Release knowledge proposal.' };
    }

    const approval = await this.approvalQueue.approve(approvalId);
    if (!approval.ok) return approval;

    const candidate = approval.item.context.candidate;

    const claim = await this.approvalQueue.beginExecution(approvalId);
    if (!claim.ok) {
      return { ok: false, error: 'Approved GitHub Release could not begin ingestion.', code: claim.code };
    }

    let pipeline;
    try {
      pipeline = this.processDocument(candidateToDocument(candidate), {
        persist: true,
        allowUpdate: true,
      });
      if (!pipeline.supported || !pipeline.persistence) {
        throw new Error('Approved GitHub Release could not enter the Knowledge Engine.');
      }
    } catch (error) {
      await this.approvalQueue.failExecution(approvalId, {
        executionId: claim.executionId,
        error: { code: 'knowledge_ingestion_failed', retryable: false },
      });
      throw error;
    }

    const completion = await this.approvalQueue.completeExecution(approvalId, {
      executionId: claim.executionId,
      result: { type: 'knowledge_ingestion', externalId: pipeline.persistence.id },
    });
    this.changeDetector.record(candidate, 'ingested', {
      approvalId,
      knowledgeObjectId: pipeline.persistence.id,
    });

    return {
      ok: true,
      action: 'approved-and-ingested',
      approval: completion.ok ? completion : approval.item,
      knowledgeObject: pipeline.knowledgeObject,
      persistence: pipeline.persistence,
    };
  }
}

module.exports = {
  UniversalKnowledgeSupervisor,
  candidateToDocument,
};
