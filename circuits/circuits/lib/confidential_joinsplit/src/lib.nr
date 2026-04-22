pub mod notes;
use notes::{ConfidentialInputNote, ConfidentialOutputNote};
use shared::{hash, assert_merkle_leaf_membership};

pub fn get_confidential_blinded_recipient_or_secret(is_wormhole: bool, recipient: Field, secret: Field) -> Field {
    let blinded_rec_or_secret = if is_wormhole {
        hash([recipient, secret])
    } else {
        // Ignore recipient and just hash the secret twice
        // In confidential transfers, the to/recipient is public
        hash([secret, secret])
    };
    hash([blinded_rec_or_secret, is_wormhole as Field])
}

pub fn to_confidential_context(is_wormhole: bool, recipient: Field, secret: Field, token: Field, token_id: Field, amount: Field) -> Field {
    let blinded_rec_or_secret = get_confidential_blinded_recipient_or_secret(is_wormhole, recipient, secret);
    hash([blinded_rec_or_secret, token, token_id, amount])
}

pub struct ConfidentialJoinSplit<let M: u32, let N: u32, let C: u32> {
    root: Field,
    from: Field,
    to: Field,
    token: Field,
    token_id: Field,
    input_notes: [ConfidentialInputNote<M>; N],
    output_notes: [ConfidentialOutputNote; C],
}

pub impl <let M: u32, let N: u32, let C: u32> ConfidentialJoinSplit<M, N, C> {
    pub fn new(root: Field, from: Field, to: Field, token: Field, token_id: Field, input_notes: [ConfidentialInputNote<M>; N], output_notes: [ConfidentialOutputNote; C]) -> Self {
        Self { root, from, to, token, token_id, input_notes, output_notes }
    }

    // outputs are input nullifiers and output confidential contexts
    pub fn execute(self) -> ([Field; N], [Field; C]) {
        let mut totalAmountIn = 0;
        let mut totalAmountOut = 0;

        let mut input_nullifiers: [Field; N] = [0; N];
        let mut output_confidential_contexts: [Field; C] = [0; C];

        // Verify input notes are valid
        for i in 0..N {
            let input_note = self.input_notes[i];
            if input_note.amount != 0 {
                let commitment = input_note.to_commitment(self.from, self.to, self.token, self.token_id);
                // Verify note commitment is in confidential tree
                assert_merkle_leaf_membership(self.root, commitment, input_note.leaf_index, input_note.leaf_path);                
                totalAmountIn += input_note.amount;
            }
            input_nullifiers[i] = input_note.get_nullifier(self.from, self.to, self.token, self.token_id);
        }

        // Verify output notes are valid
        for i in 0..C {
            let output_note = self.output_notes[i];
            totalAmountOut += output_note.amount;
            output_confidential_contexts[i] = output_note.to_confidential_context(self.token, self.token_id);
        }

        // Verify sums of input and output notes are equal
        assert(totalAmountIn != 0, "Total amount in must be non-zero");
        assert(totalAmountIn == totalAmountOut, "Total amount in and out must be equal");

        // Return (input nullifiers, output confidential contexts)
        (input_nullifiers, output_confidential_contexts)
    }
}