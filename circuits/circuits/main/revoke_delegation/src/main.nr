use utxo_delegated::{
    MERKLE_TREE_DEPTH,
    SignerNote,
    SignerDelegation,
    invalidate_signer_delegation,
};

fn main(
    eip712_domain_lo: Field,
    eip712_domain_hi: Field,
    pub_key_x: [u8; 32],
    pub_key_y: [u8; 32],
    signature: [u8; 64],
    hashed_message: [u8; 32],
    timestamp: u64,
    signer_root: Field,
    signer_note: SignerNote<MERKLE_TREE_DEPTH>,
    signer_blinding: Field,
    delegation_typehash: [u8; 32],
    delegation: SignerDelegation,
) -> pub (Field, Field, Field, Field) {
    invalidate_signer_delegation(
        eip712_domain_lo,
        eip712_domain_hi,
        pub_key_x,
        pub_key_y,
        signature,
        hashed_message,
        timestamp,
        signer_root,
        signer_note,
        signer_blinding,
        delegation_typehash,
        delegation,
    )
}
