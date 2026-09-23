// The operator Voice page (#7): a provider candidate already in the catalog
// shows "in catalog" instead of "Use as candidate" — also for a Voice added,
// approved or revoked after the search that listed it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { catalogOf, withCatalogVoice, type CatalogVoice } from '../../apps/web/lib/voice-candidates.ts';

const candidate = (id: string, catalog: { id: string; state: 'pending' | 'approved' | 'revoked'; dialect: string } | null = null) => ({
  provider_voice_id: id,
  display_name: id,
  catalog,
});
const row = (provider_voice_id: string, state: CatalogVoice['state'] = 'pending'): CatalogVoice => ({
  id: `voice-${provider_voice_id}`,
  provider_voice_id,
  state,
  dialect: 'levantine',
});

describe('candidates already in the catalog', () => {
  it('keeps the mark the search returned', () => {
    const c = candidate('el_rami_000000000', { id: 'v1', state: 'approved', dialect: 'levantine' });
    assert.deepEqual(catalogOf(c, null), { id: 'v1', state: 'approved', dialect: 'levantine' });
    assert.equal(catalogOf(candidate('el_new_0000000000'), []), null);
  });

  it('marks a candidate added after the search, from the loaded catalog rows', () => {
    const c = candidate('el_new_0000000000');
    assert.deepEqual(catalogOf(c, [row('el_other_00000000'), row('el_new_0000000000')]), {
      id: 'voice-el_new_0000000000',
      state: 'pending',
      dialect: 'levantine',
    });
  });

  it('shows the catalog row’s current state over the search’s older one', () => {
    const c = candidate('el_rami_000000000', { id: 'voice-el_rami_000000000', state: 'pending', dialect: 'levantine' });
    assert.equal(catalogOf(c, [row('el_rami_000000000', 'approved')])?.state, 'approved');
  });

  it('marks the Voice an add just returned, whatever the catalog filter shows', () => {
    const list = [candidate('el_a_000000000000'), candidate('el_b_000000000000')];
    const next = withCatalogVoice(list, row('el_b_000000000000'));
    assert.equal(next[0].catalog, null);
    assert.deepEqual(next[1].catalog, { id: 'voice-el_b_000000000000', state: 'pending', dialect: 'levantine' });
    assert.equal(list[1].catalog, null); // not mutated
  });
});
