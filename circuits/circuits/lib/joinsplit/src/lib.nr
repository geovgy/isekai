pub mod notes;
use notes::{InputNote, OutputNote, WormholeNote, get_wormhole_pseudo_nullifier};
use shared::{assert_merkle_leaf_membership};

pub struct JoinSplit<let M: u32, let N: u32, let C: u32, let W: u32> {
    chain_id: Field,
    shielded_root: Field, // master tree root
    wormhole_root: Field, // master tree root
    token: Field,
    token_id: Field,
    owner_address: Field,
    input_notes: [InputNote<M>; N],
    output_notes: [OutputNote; C],
    wormhole_notes: [Option<WormholeNote<M>>; W],
    wormhole_pseudo_secrets: [Option<Field>; W], // Only required if no wormhole note is provided (to obfuscate whether a wormhole note is provided or not)
}

pub impl <let M: u32, let N: u32, let C: u32, let W: u32> JoinSplit<M, N, C, W> {
    pub fn new(chain_id: Field, shielded_root: Field, wormhole_root: Field, token: Field, token_id: Field, owner_address: Field, input_notes: [InputNote<M>; N], output_notes: [OutputNote; C], wormhole_notes: [Option<WormholeNote<M>>; W], wormhole_pseudo_secrets: [Option<Field>; W]) -> Self {
        Self { chain_id, shielded_root, wormhole_root, token, token_id, owner_address, input_notes, output_notes, wormhole_notes, wormhole_pseudo_secrets }
    }

    // Returns (wormhole nullifier, input nullifiers, output commitments)
    // If no wormhole note is provided, then wormhole nullifier can be a pseudo nullifier to hide onchain whether a wormhole note is provided or not
    pub fn execute(self) -> ([Field; W], [Field; N], [Field; C]) {
        let mut totalAmountIn = 0;
        let mut totalAmountOut = 0;

        let mut wormhole_nullifiers: [Field; W] = [0; W];
        let mut input_nullifiers: [Field; N] = [0; N];
        let mut output_commitments: [Field; C] = [0; C];

        // Verify wormhole note (if provided - add to totalAmountIn)
        for i in 0..W {
            if self.wormhole_notes[i].is_some() {
                let wormhole_note = self.wormhole_notes[i].unwrap();
                assert(wormhole_note.dst_chain_id == self.chain_id, "Wormhole note chain id must match chain id");
                assert(wormhole_note.token == self.token, "Wormhole note token must match token");
                assert(wormhole_note.token_id == self.token_id, "Wormhole note token_id must match token_id");
                assert(wormhole_note.is_approved, "Wormhole note must be approved");
                let wormhole_leaf = wormhole_note.to_burn_commitment();
                // Verify wormhole note commitment is in branch tree
                assert_merkle_leaf_membership(wormhole_note.branch_root, wormhole_leaf, wormhole_note.branch_index, wormhole_note.branch_siblings);
                // Verify branch tree root is in master tree
                assert_merkle_leaf_membership(self.wormhole_root, wormhole_note.branch_root, wormhole_note.master_index, wormhole_note.master_siblings);
                wormhole_nullifiers[i] = wormhole_note.get_nullifier();
                totalAmountIn += wormhole_note.amount;
            } else {
                // Create a pseudo nullifier
                assert(self.wormhole_pseudo_secrets[i].is_some(), "Wormhole pseudo secret is required for pseudo nullifier");
                wormhole_nullifiers[i] = get_wormhole_pseudo_nullifier(self.chain_id, self.owner_address, self.token, self.token_id, self.wormhole_pseudo_secrets[i].unwrap());
            }
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
            output_commitments[i] = output_note.to_commitment(self.token, self.token_id);
        }

        // Verify sums of input (+ wormhole) and output notes are equal
        assert(totalAmountIn != 0, "Total amount in must be non-zero");
        assert(totalAmountIn == totalAmountOut, "Total amount in and out must be equal");

        // Return (wormhole nullifier, input nullifiers, output commitments)
        (wormhole_nullifiers, input_nullifiers, output_commitments)
    }
}
