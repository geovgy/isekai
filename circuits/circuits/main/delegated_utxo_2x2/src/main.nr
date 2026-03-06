use delegated_utxo::{
    execute_delegated_utxo, 
    MERKLE_TREE_DEPTH, 
    SignerNote, 
    SignerDelegation
};
use joinsplit::notes::{InputNote, OutputNote, WormholeNote};

fn main(
    eip712_domain_lo: pub [u8; 16],
    eip712_domain_hi: pub [u8; 16],
    pub_key_x: [u8; 32],
    pub_key_y: [u8; 32],
    signature: [u8; 64],
    hashed_message: pub [u8; 32], // Full 256-bit EIP-712 message hash
    chain_id: pub Field, // pub
    timestamp: pub u64, // pub
    shielded_root: pub Field, // pub
    wormhole_root: pub Field, // pub
    signer_root: pub Field, // pub
    signer_note: SignerNote<MERKLE_TREE_DEPTH>,
    signer_blinding: Field,
    delegation_typehash: [u8; 32],
    delegation: SignerDelegation,
    owner_pub_key_x: [u8; 32],
    owner_pub_key_y: [u8; 32],
    delegation_signature: [u8; 64],
    token: Field,
    token_id: Field,
    input_notes: [InputNote<MERKLE_TREE_DEPTH>; 2],
    output_notes: [OutputNote; 2],
    wormhole_note: Option<WormholeNote<MERKLE_TREE_DEPTH>>,
    wormhole_pseudo_secret: Option<Field>,
) -> pub (Field, Field, Field, Field, Field, [Field; 2], [Field; 2]) {
    execute_delegated_utxo(
        eip712_domain_lo,
        eip712_domain_hi,
        pub_key_x,
        pub_key_y,
        signature,
        hashed_message,
        chain_id,
        timestamp,
        shielded_root,
        wormhole_root,
        signer_root,
        signer_note,
        signer_blinding,
        delegation_typehash,
        delegation,
        owner_pub_key_x,
        owner_pub_key_y,
        delegation_signature,
        token,
        token_id,
        input_notes,
        output_notes,
        wormhole_note,
        wormhole_pseudo_secret,
    )
}