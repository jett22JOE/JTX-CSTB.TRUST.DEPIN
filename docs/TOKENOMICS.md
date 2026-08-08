# $OPTX Tokenomics — Escrow-Native Proof-of-Attention

**Status:** Canonical product model (2026-08)
**Programs:** PoA Trust + Jett Vault (`jettoptx-poa-depin`)
**Philosophy:** Real human attention is the scarce resource. $OPTX is the Attention Credit that makes that attention economically legible to agents.

---

## One-sentence summary

**$OPTX is an Attention Credit minted only on successful real gaze authentication (PIN + AGT).**  
Basic tier receives zero real tokens (shows Potential only). Higher $JTX tiers receive real $OPTX into escrow/allowance. $OPTX is released from escrow only when spent by agents in marketplaces. No hard user or supply caps — emission scales with real human attention and $JTX holdings.

---

## Core rules

### Mint trigger
Only a successful gaze authentication (PIN + AGT tensors + optional compute proof) that passes `finalize_attestation` can create real $OPTX allowance.

### Tier multipliers (applied to real allowance)

| $JTX Tier                  | Real $OPTX | What the user sees                          |
|----------------------------|------------|---------------------------------------------|
| **Basic** (≥1 or free)     | **0**      | Live “Potential $OPTX” counter only         |
| **Mojo** (≥12)             | 15 base    | Real allowance + earned amount              |
| **DOJO** (≥444)            | 20 base    | Real allowance + earned amount              |
| **Space Cowboy** (≥1,111 or NFT) | 30 base | Real allowance + earned amount + priority |

Base rates are illustrative and can be tuned via `optx_per_entropy` and difficulty multipliers already present in the PoA Trust program. The critical product rule is **Basic = 0 real mint**.

### Escrow / Allowance model
- Successful `finalize_attestation` adds to `UserEntropy.optx_minting_allowance`.
- `mint_optx` (or future spend instructions) deducts from allowance and either mints to the user or transfers into a marketplace escrow.
- Tokens become fully liquid only after marketplace consumption (agent tasks, priority, tips, compute, etc.).
- This mirrors the AgenC escrow → settle pattern while keeping the scarce resource (real gaze) under Jett control.

### No artificial ceilings
- No hard 200-user cap.
- No hard $2k / 1M $OPTX capital ceiling in the economic design.
- Emission is attention-capped: more real successful gaze events from higher-tier holders = more $OPTX, but only after real work.

---

## Flywheel

1. Hold more $JTX → higher tier  
2. Higher tier → more real $OPTX allowance per successful gaze attestation  
3. $OPTX lives in escrow/allowance until spent by agents  
4. Marketplace demand for Attention Credits + visible Potential gap pulls more capital into higher $JTX tiers  

---

## Relationship to AgenC

AgenC provides neutral, battle-tested **escrow + settlement rails** for agent labor (SOL escrow → claim → deliver → 4-way split).

Jett Optics provides the **attestation layer**:  
- Real human gaze + AGT (COG / EMO / ENV) proves attention.  
- Only attested attention can authorize higher-value $OPTX flows, priority, or rewards.  

We augment AgenC infrastructure; we own the biometric-grade attestation surface.

Permission to interact with AgenC smart contracts and open PRs has been confirmed.

---

## Implementation notes (PoA Trust)

Current on-chain surface already supports the allowance model:

- `finalize_attestation` → adds to `optx_minting_allowance`
- `mint_optx` → deducts allowance and mints

Product enforcement of **Basic = 0** can be realized by:

1. **Preferred (client + edge):** AARON / MOJO / JETT Auth check live $JTX balance and only submit meaningful entropy / call finalize for paid tiers. Basic users still complete the handshake UX but receive Potential UI only.
2. **On-chain (future upgrade):** Read user’s $JTX token account in `finalize_attestation` and apply a tier multiplier (0× / 1.5× / 2× / 3×). Requires careful account layout and upgrade under the live NEW_JOE authority.

Either path preserves the existing double-mint, pause, and replay protections.

---

## Public messaging (copy-paste)

**$OPTX – Proof-of-Attention Utility**  
- Minted only on successful gaze authentication (PIN + AGT)  
- Basic: 0 real $OPTX (shows Potential only)  
- Mojo / DOJO / Space Cowboy: real $OPTX into escrow  
- Released from escrow only when spent by agents  
- No hard supply or user caps — scales with real attention  

---

*Last updated: 2026-08-08*  
*Source of truth: this file + live PoA Trust / Jett Vault programs*
