use poseidon::poseidon2::Poseidon2;

pub fn hash<let N: u32>(inputs: [Field; N]) -> Field {
    Poseidon2::hash(inputs, N)
}

// M is the max depth of the merkle tree
pub fn calculate_root<let M: u32>(leaf: Field, index: Field, paths: [Field; M]) -> Field {
    let mut hashed = leaf;

    let mut idx = index as u32;
    for i in 0..paths.len() {
        if paths[i] != 0 {
            let is_right = ((idx & 1) == 0) as bool;
            let (hash_left, hash_right) = if is_right {
                (hashed, paths[i])
            } else {
                (paths[i], hashed)
            };
            hashed = hash([hash_left, hash_right]);
            idx >>= 1;
        }
    };

    hashed
}

pub fn assert_merkle_leaf_membership<let M: u32>(root: Field, leaf: Field, index: Field, paths: [Field; M]) {
    assert(calculate_root(leaf, index, paths) == root, "Merkle leaf membership check failed");
}

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