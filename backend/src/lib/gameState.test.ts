import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasCorrectAnswer, registerCorrectAnswer, setActiveTrack } from './gameState.js';


describe('équipes — une seule réponse par équipe', () => {
  it('la 2ᵉ bonne réponse de la même équipe ne marque pas', () => {
    const roundId = 'r-equipe';
    setActiveTrack(roundId, {
      round_id: roundId,
      track_id: 't1',
      track_index: 0,
      started_at_ms: Date.now(),
    });
    const base = {
      matched_artist: true,
      matched_title: false,
      score: 20,
      score_position: 20,
      score_title_bonus: 0,
      score_speed_bonus: 0,
    };
    const premier = registerCorrectAnswer(roundId, {
      participant_id: 'p1',
      pseudo: 'Marion',
      team_id: 'equipe-bleue',
      ...base,
    });
    assert.ok(premier);
    assert.equal(hasCorrectAnswer(roundId, 'p2', 'equipe-bleue'), true);
    const second = registerCorrectAnswer(roundId, {
      participant_id: 'p2',
      pseudo: 'Kevin',
      team_id: 'equipe-bleue',
      ...base,
    });
    assert.equal(second, null);
    // Une autre équipe marque normalement.
    const autre = registerCorrectAnswer(roundId, {
      participant_id: 'p3',
      pseudo: 'Sophie',
      team_id: 'equipe-rouge',
      ...base,
    });
    assert.ok(autre);
  });
});
