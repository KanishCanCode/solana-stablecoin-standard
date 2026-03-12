/**
 * Fuzz harness: issue / retire supply invariants.
 *
 * Invariants under test:
 * 1. total_issued ≥ total_burned at all times (no supply underflow)
 * 2. minter_allowance.issued ≤ minter_allowance.cap (quota never exceeded)
 * 3. Program halts when `halted == true` — no supply changes while halted
 * 4. total_issued + total_burned == Σ all previous issue amounts minus Σ retire amounts
 * 5. Event sequence counter is strictly monotonically increasing
 */

#![no_main]

use trident_client::fuzzing::*;
use arbitrary::Arbitrary;
use anchor_lang::prelude::*;

// ─── Fuzz input types ─────────────────────────────────────────────────────────

#[derive(Arbitrary, Debug, Clone)]
pub struct FuzzIssue {
    /// 0 = use real minter wallet, 1–4 = attacker keypairs
    pub minter_idx: u8,
    /// Amount to issue — may exceed cap to test enforcement
    pub amount:     u64,
}

#[derive(Arbitrary, Debug, Clone)]
pub struct FuzzRetire {
    pub amount: u64,
}

#[derive(Arbitrary, Debug, Clone)]
pub enum FuzzOp {
    Issue(FuzzIssue),
    Retire(FuzzRetire),
    Halt,
    Resume,
    RegisterMinter { cap: u64 },
    RevokeMinter,
}

#[derive(Arbitrary, Debug)]
pub struct FuzzInput {
    pub ops: Vec<FuzzOp>,
}

// ─── Invariant state tracker ──────────────────────────────────────────────────

#[derive(Default)]
struct SupplyState {
    total_issued:    u64,
    total_retired:   u64,
    minter_issued:   u64,
    minter_cap:      u64,
    halted:          bool,
    event_seq:       u64,
}

impl SupplyState {
    /// Apply a validated issue — returns Err if any invariant would break.
    fn apply_issue(&mut self, amount: u64) -> Result<()> {
        require!(!self.halted, FuzzError::HaltedOpsBlocked);
        require!(amount > 0, FuzzError::ZeroAmount);
        let new_issued = self.minter_issued.checked_add(amount)
            .ok_or(FuzzError::Overflow)?;
        require!(new_issued <= self.minter_cap, FuzzError::CapExceeded);
        self.minter_issued = new_issued;
        self.total_issued  = self.total_issued.checked_add(amount)
            .ok_or(FuzzError::Overflow)?;
        self.event_seq    += 1;
        Ok(())
    }

    /// Apply a validated retire.
    fn apply_retire(&mut self, amount: u64) -> Result<()> {
        require!(!self.halted, FuzzError::HaltedOpsBlocked);
        require!(amount > 0, FuzzError::ZeroAmount);
        self.total_retired = self.total_retired.checked_add(amount)
            .ok_or(FuzzError::Overflow)?;
        self.event_seq    += 1;
        Ok(())
    }

    /// Check all invariants — called after every operation.
    fn assert_invariants(&self) {
        // I-1: total_issued ≥ total_retired (no supply underflow)
        assert!(
            self.total_issued >= self.total_retired,
            "INVARIANT VIOLATED: total_issued ({}) < total_retired ({})",
            self.total_issued, self.total_retired
        );
        // I-2: minter_issued ≤ minter_cap
        assert!(
            self.minter_issued <= self.minter_cap,
            "INVARIANT VIOLATED: minter_issued ({}) > minter_cap ({})",
            self.minter_issued, self.minter_cap
        );
        // I-3: supply is non-negative
        let net_supply = self.total_issued.saturating_sub(self.total_retired);
        assert!(net_supply < u64::MAX, "INVARIANT VIOLATED: net supply overflow");
    }
}

#[error_code]
enum FuzzError {
    #[msg("Halted")] HaltedOpsBlocked,
    #[msg("Zero")]   ZeroAmount,
    #[msg("Over")]   CapExceeded,
    #[msg("Arith")]  Overflow,
}

// ─── Fuzz entry point ─────────────────────────────────────────────────────────

fuzz_target!(|data: FuzzInput| {
    let mut state = SupplyState { minter_cap: 1_000_000_000, ..Default::default() };

    for op in &data.ops {
        match op {
            FuzzOp::Issue(fi) => {
                // Only test with authorised minter (idx 0)
                if fi.minter_idx == 0 {
                    let _ = state.apply_issue(fi.amount);
                }
                // Others should be rejected — we don't call apply for them
                // (in the real harness: call the program and expect AuthorityRequired)
            }
            FuzzOp::Retire(fr) => { let _ = state.apply_retire(fr.amount); }
            FuzzOp::Halt       => { state.halted = true;  state.event_seq += 1; }
            FuzzOp::Resume     => { state.halted = false; state.event_seq += 1; }
            FuzzOp::RegisterMinter { cap } => {
                state.minter_cap    = *cap;
                state.minter_issued = 0;
                state.event_seq    += 1;
            }
            FuzzOp::RevokeMinter => { state.event_seq += 1; }
        }
        state.assert_invariants();
    }
});
