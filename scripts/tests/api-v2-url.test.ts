import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiV2BaseUrl } from '../../apps/web/lib/api-v2-url.ts';

describe('which api-v2 the web proxies call', () => {
  it('every product route (drafts, voices, uploads, quote, run, run status) reads API_V2_URL', () => {
    assert.equal(apiV2BaseUrl('api', { API_V2_URL: 'http://api-v2:3001/' }), 'http://api-v2:3001');
  });
  it('AGENT_API_V2_URL does NOT redirect product routes, so a quote and its run hit one backend', () => {
    assert.equal(apiV2BaseUrl('api', { API_V2_URL: 'https://a.test', AGENT_API_V2_URL: 'http://localhost:3001' }), 'https://a.test');
  });
  it('the agent brain and its chat persistence may still be pointed elsewhere (deprecated override)', () => {
    assert.equal(apiV2BaseUrl('agent', { API_V2_URL: 'https://a.test', AGENT_API_V2_URL: 'http://localhost:3001//' }), 'http://localhost:3001');
    assert.equal(apiV2BaseUrl('agent', { API_V2_URL: 'https://a.test' }), 'https://a.test');
  });
  it('falls back to the hosted API when nothing is set', () => {
    assert.equal(apiV2BaseUrl('api', {}), 'https://api.agent-media.ai');
    assert.equal(apiV2BaseUrl('api', { API_V2_URL: '  ' }), 'https://api.agent-media.ai');
  });
});
