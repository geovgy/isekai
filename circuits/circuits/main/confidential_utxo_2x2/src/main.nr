use utxo::{execute_confidential_utxo, MERKLE_TREE_DEPTH};
use joinsplit::notes::{ConfidentialInputNote, ConfidentialOutputNote};

fn main(
    root: pub Field,
    from: pub Field,
    to: pub Field,
    token: pub Field,
    token_id: Field,
    input_notes: [ConfidentialInputNote<MERKLE_TREE_DEPTH>; 2],
    output_notes: [ConfidentialOutputNote; 2],
) -> pub ([Field; 2], [Field; 2]) {
    execute_confidential_utxo(
        root,
        from,
        to,
        token,
        token_id,
        input_notes,
        output_notes,
    )
}