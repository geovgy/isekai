use delegated_utxo::{BatchDelegatedUtxo, execute_batch_delegated_utxo};

fn main(
    eip712_domain_lo: pub Field,
    eip712_domain_hi: pub Field,
    pub_key_x: [u8; 32],
    pub_key_y: [u8; 32],
    signature: [u8; 64],
    hashed_message: [u8; 32], // Full 256-bit EIP-712 message hash
    chain_id: pub Field, // pub
    timestamp: pub u64, // pub
    delegation_typehash: [u8; 32],
    shielded_roots: pub [Field; 4], // pub
    wormhole_roots: pub [Field; 4], // pub
    signer_roots: pub [Field; 4], // pub
    transactions: [BatchDelegatedUtxo<20, 2, 2, 1>; 4],
) -> pub (Field, Field, [Field; 4], [Field; 4], [[Field; 1]; 4], [[Field; 2]; 4], [[Field; 2]; 4]) {
    execute_batch_delegated_utxo(
        eip712_domain_lo,
        eip712_domain_hi,
        pub_key_x,
        pub_key_y,
        signature,
        hashed_message,
        chain_id,
        timestamp,
        delegation_typehash,
        shielded_roots,
        wormhole_roots,
        signer_roots,
        transactions,
    )
}