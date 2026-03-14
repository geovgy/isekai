use joinsplit::{
    notes::{InputNote, OutputNote, WormholeNote, get_wormhole_pseudo_nullifier},
    assert_merkle_leaf_membership,
};
use crate::{SignerDelegation, SignerNote};

pub struct DelegateJoinSplit<let M: u32, let N: u32, let C: u32> {
    chain_id: Field,
    timestamp: u64,
    shielded_root: Field, // master tree root
    wormhole_root: Field, // master tree root
    token: Field,
    token_id: Field,
    owner_address: Field,
    delegation: SignerDelegation,
    input_notes: [InputNote<M>; N],
    output_notes: [OutputNote; C],
    wormhole_note: Option<WormholeNote<M>>,
    wormhole_pseudo_secret: Option<Field>, // Only required if no wormhole note is provided (to obfuscate whether a wormhole note is provided or not)
    signer_note: SignerNote<M>,
}

pub impl <let M: u32, let N: u32, let C: u32> DelegateJoinSplit<M, N, C> {
    pub fn new(chain_id: Field, timestamp: u64, shielded_root: Field, wormhole_root: Field, token: Field, token_id: Field, owner_address: Field, delegation: SignerDelegation, input_notes: [InputNote<M>; N], output_notes: [OutputNote; C], wormhole_note: Option<WormholeNote<M>>, wormhole_pseudo_secret: Option<Field>, signer_note: SignerNote<M>) -> Self {
        Self { chain_id, timestamp, shielded_root, wormhole_root, token, token_id, owner_address, delegation, input_notes, output_notes, wormhole_note, wormhole_pseudo_secret, signer_note }
    }

    // Returns (total amount sent, wormhole nullifier, input nullifiers, output commitments)
    // If no wormhole note is provided, then wormhole nullifier can be a pseudo nullifier to hide onchain whether a wormhole note is provided or not
    pub fn execute(self) -> (Field, Field, [Field; N], [Field; C]) {
        let mut totalAmountIn = 0;
        let mut totalAmountOut = 0;

        let mut totalAmountSent = 0; // amount sent to another address

        let mut wormhole_nullifier = 0;
        let mut input_nullifiers: [Field; N] = [0; N];
        let mut output_commitments: [Field; C] = [0; C];

        // Verify wormhole note (if provided - add to totalAmountIn)
        if self.wormhole_note.is_some() {
            let wormhole_note = self.wormhole_note.unwrap();
            assert(wormhole_note.dst_chain_id == self.chain_id, "Wormhole note chain id must match chain id");
            assert(wormhole_note.token == self.token, "Wormhole note token must match token");
            assert(wormhole_note.token_id == self.token_id, "Wormhole note token_id must match token_id");
            assert(wormhole_note.is_approved, "Wormhole note must be approved");
            let wormhole_leaf = wormhole_note.to_burn_commitment();
            // Verify wormhole note commitment is in branch tree
            assert_merkle_leaf_membership(wormhole_note.branch_root, wormhole_leaf, wormhole_note.branch_index, wormhole_note.branch_siblings);
            // Verify branch tree root is in master tree
            assert_merkle_leaf_membership(self.wormhole_root, wormhole_note.branch_root, wormhole_note.master_index, wormhole_note.master_siblings);
            wormhole_nullifier = wormhole_note.get_nullifier();
            totalAmountIn += wormhole_note.amount;
        } else {
            // Create a pseudo nullifier
            assert(self.wormhole_pseudo_secret.is_some(), "Wormhole pseudo secret is required for pseudo nullifier");
            wormhole_nullifier = get_wormhole_pseudo_nullifier(self.chain_id, self.owner_address, self.token, self.token_id, self.wormhole_pseudo_secret.unwrap());
        }

        // Verify input notes are valid
        for i in 0..N {
            let input_note = self.input_notes[i];
            if input_note.amount != 0 {
                let commitment = input_note.to_commitment(self.owner_address, self.token, self.token_id);
                // Should only use notes from this chain
                assert(input_note.chain_id == self.chain_id, "Input note chain id must match chain id");
                // Verify note commitment is in branch tree
                assert_merkle_leaf_membership(input_note.branch_root, commitment, input_note.branch_index, input_note.branch_siblings);
                // Verify branch tree root is in master tree
                assert_merkle_leaf_membership(self.shielded_root, input_note.branch_root, input_note.master_index, input_note.master_siblings);
                totalAmountIn += input_note.amount;
            }
            input_nullifiers[i] = input_note.get_nullifier(self.owner_address, self.token, self.token_id);
        }

        // Verify output notes are valid
        for i in 0..C {
            let output_note = self.output_notes[i];
            totalAmountOut += output_note.amount;
            if (output_note.recipient != self.owner_address) {
                totalAmountSent += output_note.amount;
            }
            output_commitments[i] = output_note.to_commitment(self.token, self.token_id);
        }

        // Verify sums of input (+ wormhole) and output notes are equal
        assert(totalAmountIn != 0, "Total amount in must be non-zero");
        assert(totalAmountIn == totalAmountOut, "Total amount in and out must be equal");

        // verify delegation
        assert(self.delegation.chainId as Field == self.chain_id, "Delegation chain id must match chain id");
        assert(self.delegation.owner == self.owner_address, "Delegation owner must match owner address");
        if (self.delegation.startTime != 0) {
            assert(self.delegation.startTime <= self.timestamp, "Delegation start time must be before timestamp");
        }
        if (self.delegation.endTime != 0) {
            assert(self.delegation.endTime >= self.timestamp, "Delegation end time must be after timestamp");
        }
        if (self.delegation.timeInterval != 0) {
            assert(self.delegation.timeInterval <= self.timestamp - self.signer_note.timestamp, "Delegation time interval must be less than or equal to time interval");
        }
        assert(self.delegation.token == self.token, "Delegation token must match token");
        if (self.delegation.amountType == 0) | (self.delegation.amountType == 1) | (self.delegation.amountType == 2) {
            assert(self.delegation.tokenId == self.token_id, "Delegation token_id must match token_id");
        }
        if (self.delegation.amountType == 0) | (self.delegation.amountType == 3) {
            assert(self.delegation.amount == totalAmountSent, "Delegation amount must match total amount sent");
        } else if (self.delegation.amountType == 1) | (self.delegation.amountType == 4) {
            assert(self.delegation.amount as u64 <= totalAmountSent as u64, "Delegation amount must be less than or equal to total amount sent");
        } else if (self.delegation.amountType == 2) | (self.delegation.amountType == 5) {
            assert(self.delegation.amount as u64 >= totalAmountSent as u64, "Delegation amount must be greater than or equal to total amount sent");
        }

        // Return (wormhole nullifier, input nullifiers, output commitments)
        (totalAmountSent, wormhole_nullifier, input_nullifiers, output_commitments)
    }
}