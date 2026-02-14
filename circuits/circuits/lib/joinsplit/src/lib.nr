pub mod notes;
use notes::{InputNote, OutputNote, WormholeNote, get_wormhole_pseudo_nullifier};
use poseidon::poseidon2::Poseidon2;

pub struct JoinSplit<let M: u32, let N: u32, let C: u32> {
    chain_id: Field,
    shielded_root: Field, // master tree root
    wormhole_root: Field, // master tree root
    asset_id: Field,
    owner_address: Field,
    input_notes: [InputNote<M>; N],
    output_notes: [OutputNote; C],
    wormhole_note: Option<WormholeNote<M>>,
    wormhole_pseudo_secret: Option<Field>, // Only required if no wormhole note is provided (to obfuscate whether a wormhole note is provided or not)
}

fn hasher<let N: u32>(inputs: [Field; N]) -> Field {
    Poseidon2::hash(inputs, N)
}

// M is the max depth of the merkle tree
fn calculate_root<let M: u32>(leaf: Field, index: Field, paths: [Field; M]) -> Field {
    let mut hash = leaf;

    let mut idx = index as u32;
    for i in 0..paths.len() {
        if paths[i] != 0 {
            let is_right = ((idx & 1) == 0) as bool;
            let (hash_left, hash_right) = if is_right {
                (hash, paths[i])
            } else {
                (paths[i], hash)
            };
            hash = hasher([hash_left, hash_right]);
            idx >>= 1;
        }
    };

    hash
}

pub fn assert_merkle_leaf_membership<let M: u32>(root: Field, leaf: Field, index: Field, paths: [Field; M]) {
    assert(calculate_root(leaf, index, paths) == root, "Merkle leaf membership check failed");
}

pub impl <let M: u32, let N: u32, let C: u32> JoinSplit<M, N, C> {
    pub fn new(chain_id: Field, shielded_root: Field, wormhole_root: Field, asset_id: Field, owner_address: Field, input_notes: [InputNote<M>; N], output_notes: [OutputNote; C], wormhole_note: Option<WormholeNote<M>>, wormhole_pseudo_secret: Option<Field>) -> Self {
        Self { chain_id, shielded_root, wormhole_root, asset_id, owner_address, input_notes, output_notes, wormhole_note, wormhole_pseudo_secret }
    }

    // Returns (wormhole nullifier, input nullifiers, output commitments)
    // If no wormhole note is provided, then wormhole nullifier can be a pseudo nullifier to hide onchain whether a wormhole note is provided or not
    pub fn execute(self) -> (Field, [Field; N], [Field; C]) {
        let mut totalAmountIn = 0;
        let mut totalAmountOut = 0;

        let mut wormhole_nullifier = 0;
        let mut input_nullifiers: [Field; N] = [0; N];
        let mut output_commitments: [Field; C] = [0; C];

        // Verify wormhole note (if provided - add to totalAmountIn)
        if self.wormhole_note.is_some() {
            let wormhole_note = self.wormhole_note.unwrap();
            assert(wormhole_note.chain_id == self.chain_id, "Wormhole note chain id must match chain id");
            assert(wormhole_note.asset_id == self.asset_id, "Wormhole note asset id must match asset id");
            assert(wormhole_note.is_approved, "Wormhole note must be approved");
            let wormhole_leaf = wormhole_note.to_burn_commitment();
            // Verify wormhole note commitment is in branch tree
            assert_merkle_leaf_membership(self.wormhole_root, wormhole_leaf, wormhole_note.branch_index, wormhole_note.branch_siblings);
            // Verify branch tree root is in master tree
            assert_merkle_leaf_membership(self.wormhole_root, wormhole_note.branch_root, wormhole_note.master_index, wormhole_note.master_siblings);
            wormhole_nullifier = wormhole_note.get_nullifier();
            totalAmountIn += wormhole_note.amount;
        } else {
            // Create a pseudo nullifier
            assert(self.wormhole_pseudo_secret.is_some(), "Wormhole pseudo secret is required for pseudo nullifier");
            wormhole_nullifier = get_wormhole_pseudo_nullifier(self.chain_id, self.owner_address, self.asset_id, self.wormhole_pseudo_secret.unwrap());
        }

        // Verify input notes are valid
        for i in 0..N {
            let input_note = self.input_notes[i];
            if input_note.amount != 0 {
                let commitment = input_note.to_commitment(self.owner_address, self.asset_id);
                // Should only use notes from this chain
                assert(input_note.chain_id == self.chain_id, "Input note chain id must match chain id");
                // Verify note commitment is in branch tree
                assert_merkle_leaf_membership(input_note.branch_root, commitment, input_note.branch_index, input_note.branch_siblings);
                // Verify branch tree root is in master tree
                assert_merkle_leaf_membership(self.shielded_root, input_note.branch_root, input_note.master_index, input_note.master_siblings);
                totalAmountIn += input_note.amount;
            }
            input_nullifiers[i] = input_note.get_nullifier(self.owner_address, self.asset_id);
        }

        // Verify output notes are valid
        for i in 0..C {
            let output_note = self.output_notes[i];
            assert(output_note.amount != 0, "Output note amount cannot be 0");
            totalAmountOut += output_note.amount;
            output_commitments[i] = output_note.to_commitment(self.asset_id);
        }

        // Verify sums of input (+ wormhole) and output notes are equal
        assert(totalAmountIn == totalAmountOut, "Total amount in and out must be equal");

        // Return (wormhole nullifier, input nullifiers, output commitments)
        (wormhole_nullifier, input_nullifiers, output_commitments)
    }
}