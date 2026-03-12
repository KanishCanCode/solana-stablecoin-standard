/**
 * Fuzz harness: Tier-3 co-sign gate invariants.
 *
 * Invariants under test:
 * 1. A proposal can only be executed once (replay protection via `executed` flag)
 * 2. Only registered co-signers can vote (UnrecognisedCosigner)
 * 3. The same co-signer cannot vote twice (DuplicateVote via vote_mask bitmask)
 * 4. A proposal cannot be executed before reaching the cosign_threshold
 * 5. A proposal cannot be voted on or executed after expiry (ProposalExpired)
 * 6. vote_count ≤ cosign_threshold after threshold votes (gate should have opened)
 * 7. vote_mask has exactly `vote_count` bits set at all times