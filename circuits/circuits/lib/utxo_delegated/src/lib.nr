pub mod delegate_joinsplit;
use joinsplit::{
    notes::{InputNote, OutputNote, WormholeNote},
    assert_merkle_leaf_membership,
};
use delegate_joinsplit::DelegateJoinSplit;
use ecrecover::ecrecover;
use eip712;
use poseidon::poseidon2::Poseidon2;

pub global MERKLE_TREE_DEPTH: u32 = 20;

pub struct SignerDelegation {
    pub chainId: u64,
    pub owner: Field,
    pub delegate: Field,
    pub recipient: Field,
    pub recipientLocked: bool, // true: only send to recipient, false: send to anyone
    pub startTime: u64,
    pub endTime: u64,
    pub token: Field,
    pub tokenId: Field,
    pub amount: Field,
    pub amountType: u8, // 0: exact (enforce tokenId), 1: max (enforce tokenId), 2: min (enforce tokenId), 3: exact (ignore tokenId), 4: max (ignore tokenId), 5: min (ignore tokenId)
    pub maxCumulativeAmount: u64,
    pub maxNonce: u64,
    pub timeInterval: u64,
    pub transferType: u8, // 0: transfer, 1: withdrawal
}

pub struct SignerNote<let M: u32> {
    index: Field,
    siblings: [Field; M],
    total_amount: u64,
    nonce: u64,
    timestamp: u64,
    blinding: Field,
}

pub impl <let M: u32> SignerNote<M> {
    pub fn new(index: Field, siblings: [Field; M], total_amount: u64, nonce: u64, timestamp: u64, blinding: Field) -> Self {
        Self { index, siblings, total_amount, nonce, timestamp, blinding }
    }

    pub fn get_commitment(self, delegate_address: Field, owner_address: Field, delegation_hash: [u8; 32]) -> Field {
        hash([delegate_address, owner_address, Field::from_be_bytes(delegation_hash), self.total_amount as Field, self.nonce as Field, self.timestamp as Field, self.blinding])
    }

    pub fn get_nullifier(self, delegate_address: Field, owner_address: Field, delegation_hash: [u8; 32]) -> Field {
        hash([delegate_address, owner_address, Field::from_be_bytes(delegation_hash), self.nonce as Field])
    }
}

fn hash<let N: u32>(inputs: [Field; N]) -> Field {
    Poseidon2::hash(inputs, N)
}

fn hash_signer_delegation(eip712_domain: [u8; 32], delegation_typehash: [u8; 32], delegation: SignerDelegation) -> [u8; 32] {
    let chain_id_bytes: [u8; 32] = (delegation.chainId as Field).to_be_bytes();
    let owner_bytes: [u8; 32] = delegation.owner.to_be_bytes();
    let delegate_bytes: [u8; 32] = delegation.delegate.to_be_bytes();
    let recipient_bytes: [u8; 32] = delegation.recipient.to_be_bytes();
    let recipient_locked_bytes: [u8; 32] = (delegation.recipientLocked as Field).to_be_bytes();
    let start_time_bytes: [u8; 32] = (delegation.startTime as Field).to_be_bytes();
    let end_time_bytes: [u8; 32] = (delegation.endTime as Field).to_be_bytes();
    let token_bytes: [u8; 32] = delegation.token.to_be_bytes();
    let token_id_bytes: [u8; 32] = delegation.tokenId.to_be_bytes();
    let amount_bytes: [u8; 32] = delegation.amount.to_be_bytes();
    let amount_type_bytes: [u8; 32] = (delegation.amountType as Field).to_be_bytes();
    let max_cumulative_amount_bytes: [u8; 32] = (delegation.maxCumulativeAmount as Field).to_be_bytes();
    let max_nonce_bytes: [u8; 32] = (delegation.maxNonce as Field).to_be_bytes();
    let time_interval_bytes: [u8; 32] = (delegation.timeInterval as Field).to_be_bytes();
    let transfer_type_bytes: [u8; 32] = (delegation.transferType as Field).to_be_bytes();

    // abi.encode(...) for the struct fields, excluding the typehash prefix that
    // `to_struct_hash` prepends internally.
    let mut encoded: [u8; 480] = [0; 480];
    for i in 0..32 {
        encoded[i] = chain_id_bytes[i];
        encoded[32 + i] = owner_bytes[i];
        encoded[64 + i] = delegate_bytes[i];
        encoded[96 + i] = recipient_bytes[i];
        encoded[128 + i] = recipient_locked_bytes[i];
        encoded[160 + i] = start_time_bytes[i];
        encoded[192 + i] = end_time_bytes[i];
        encoded[224 + i] = token_bytes[i];
        encoded[256 + i] = token_id_bytes[i];
        encoded[288 + i] = amount_bytes[i];
        encoded[320 + i] = amount_type_bytes[i];
        encoded[352 + i] = max_cumulative_amount_bytes[i];
        encoded[384 + i] = max_nonce_bytes[i];
        encoded[416 + i] = time_interval_bytes[i];
        encoded[448 + i] = transfer_type_bytes[i];
    }

    let struct_hash = eip712::to_struct_hash(delegation_typehash, encoded);
    eip712::hash_typed_data_v4(eip712_domain, struct_hash)
}

pub fn execute_delegated_utxo<let M: u32, let N: u32, let C: u32>(
    eip712_domain_lo: Field,
    eip712_domain_hi: Field,
    pub_key_x: [u8; 32],
    pub_key_y: [u8; 32],
    signature: [u8; 64],
    hashed_message: [u8; 32], // Full 256-bit EIP-712 message hash
    chain_id: Field, // pub
    timestamp: u64, // pub
    shielded_root: Field, // pub
    wormhole_root: Field, // pub
    signer_root: Field, // pub
    mut signer_note: SignerNote<M>,
    signer_blinding: Field,
    delegation_typehash: [u8; 32],
    delegation: SignerDelegation,
    owner_pub_key_x: [u8; 32],
    owner_pub_key_y: [u8; 32],
    delegation_signature: [u8; 64],
    token: Field,
    token_id: Field,
    input_notes: [InputNote<M>; N],
    output_notes: [OutputNote; C],
    wormhole_note: Option<WormholeNote<M>>,
    wormhole_pseudo_secret: Option<Field>,
) -> (Field, Field, Field, Field, Field, [Field; N], [Field; C]) {
    let delegate_address = ecrecover(pub_key_x, pub_key_y, signature, hashed_message);
    assert(delegate_address == delegation.delegate, "delegation signer is not delegate address");
    
    let eip712_domain_lo_bytes: [u8; 16] = eip712_domain_lo.to_be_bytes();
    let eip712_domain_hi_bytes: [u8; 16] = eip712_domain_hi.to_be_bytes();
    let eip712_domain: [u8; 32] = eip712_domain_hi_bytes.concat(eip712_domain_lo_bytes);

    let delegation_hash = hash_signer_delegation(eip712_domain, delegation_typehash, delegation);
    let owner_address = ecrecover(owner_pub_key_x, owner_pub_key_y, delegation_signature, delegation_hash);
    assert(owner_address == delegation.owner, "delegation signer is not owner address");

    // Split 256-bit hash into two 128-bit halves for public output
    // Each half fits safely within the BN254 scalar field
    let mut hashed_message_hi: [u8; 16] = [0; 16];
    let mut hashed_message_lo: [u8; 16] = [0; 16];
    for i in 0..16 {
        hashed_message_hi[i] = hashed_message[i];
        hashed_message_lo[i] = hashed_message[i + 16];
    }

    let mut signer_commitment = signer_note.get_commitment(delegate_address, owner_address, delegation_hash);
    if (signer_note.nonce > 0) {
        assert_merkle_leaf_membership(signer_root, signer_commitment, signer_note.index, signer_note.siblings);
    }
    
    let signer_nullifier = signer_note.get_nullifier(delegate_address, owner_address, delegation_hash);

    let joinsplit = DelegateJoinSplit::new(
        chain_id,
        timestamp,
        shielded_root,
        wormhole_root,
        token,
        token_id,
        owner_address,
        delegation,
        input_notes,
        output_notes,
        wormhole_note,
        wormhole_pseudo_secret,
        signer_note
    );
    let (totalAmountSent, wormhole_nullifier, input_nullifiers, output_commitments) = joinsplit.execute();

    signer_note.total_amount += totalAmountSent as u64;
    if (delegation.maxCumulativeAmount != 0) {
        assert(signer_note.total_amount <= delegation.maxCumulativeAmount as u64, "Signer note total amount must be less than or equal to max cumulative amount");
    }
    signer_note.nonce += 1;
    signer_note.timestamp = timestamp;
    signer_note.blinding = signer_blinding;

    // Get new signer commitment
    signer_commitment = signer_note.get_commitment(delegate_address, owner_address, delegation_hash);

    (Field::from_be_bytes(hashed_message_hi), Field::from_be_bytes(hashed_message_lo), signer_commitment, signer_nullifier, wormhole_nullifier, input_nullifiers, output_commitments)
}