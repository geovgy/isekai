use joinsplit::{
    JoinSplit,
    ConfidentialJoinSplit,
    notes::{InputNote, OutputNote, WormholeNote, ConfidentialInputNote, ConfidentialOutputNote},
};
use ecrecover::ecrecover;

pub global MERKLE_TREE_DEPTH: u32 = 20;

pub fn execute_utxo<let M: u32, let N: u32, let C: u32, let W: u32>(
    pub_key_x: [u8; 32],
    pub_key_y: [u8; 32],
    signature: [u8; 64],
    hashed_message: [u8; 32], // Full 256-bit EIP-712 message hash
    chain_id: Field,
    shielded_root: Field, // pub
    wormhole_root: Field, // pub
    token: Field,
    token_id: Field,
    owner_address: Field,
    input_notes: [InputNote<M>; N],
    output_notes: [OutputNote; C],
    wormhole_notes: [Option<WormholeNote<M>>; W],
    wormhole_pseudo_secrets: [Option<Field>; W],
) -> (Field, Field, [Field; W], [Field; N], [Field; C]) {
    let address = ecrecover(pub_key_x, pub_key_y, signature, hashed_message);
    assert(address == owner_address, "signer address is not owner address");

    // Split 256-bit hash into two 128-bit halves for public output
    // Each half fits safely within the BN254 scalar field
    let mut hashed_message_hi: [u8; 16] = [0; 16];
    let mut hashed_message_lo: [u8; 16] = [0; 16];
    for i in 0..16 {
        hashed_message_hi[i] = hashed_message[i];
        hashed_message_lo[i] = hashed_message[i + 16];
    }

    let joinsplit = JoinSplit::new(
        chain_id,
        shielded_root,
        wormhole_root,
        token,
        token_id,
        owner_address,
        input_notes,
        output_notes,
        wormhole_notes,
        wormhole_pseudo_secrets
    );
    let (wormhole_nullifiers, input_nullifiers, output_commitments) = joinsplit.execute();
    (Field::from_be_bytes(hashed_message_hi), Field::from_be_bytes(hashed_message_lo), wormhole_nullifiers, input_nullifiers, output_commitments)
}

pub fn execute_confidential_utxo<let M: u32, let N: u32, let C: u32>(
    root: Field,
    from: Field,
    to: Field,
    token: Field,
    token_id: Field,
    input_notes: [ConfidentialInputNote<M>; N],
    output_notes: [ConfidentialOutputNote; C],
) -> ([Field; N], [Field; C]) {
    let joinsplit = ConfidentialJoinSplit::new(
        root,
        from,
        to,
        token,
        token_id,
        input_notes,
        output_notes
    );
    let (input_nullifiers, output_confidential_contexts) = joinsplit.execute();
    (input_nullifiers, output_confidential_contexts)
}