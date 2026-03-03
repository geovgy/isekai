use poseidon::poseidon2::Poseidon2;

fn hash<let N: u32>(inputs: [Field; N]) -> Field {
    Poseidon2::hash(inputs, N)
}

pub struct InputNote<let M: u32> {
    pub chain_id: Field,
    pub blinding: Field,
    pub amount: Field,
    pub branch_index: Field, // in shielded pool branch commitment tree
    pub branch_siblings: [Field; M], // in shielded pool branch commitment tree
    pub branch_root: Field, // in shielded pool branch commitment tree
    pub master_index: Field, // where branch root is in shielded pool master commitment tree
    pub master_siblings: [Field; M], // where branch root is in shielded pool master commitment tree
}

pub impl <let M: u32> InputNote<M> {
    pub fn from(chain_id: Field, blinding: Field, amount: Field, branch_index: Field, branch_siblings: [Field; M], branch_root: Field, master_index: Field, master_siblings: [Field; M]) -> Self {
        Self { chain_id, blinding, amount, branch_index, branch_siblings, branch_root, master_index, master_siblings }
    }

    pub fn to_commitment(self, owner_address: Field, token: Field, token_id: Field) -> Field {
        let blinded_owner = hash([self.chain_id, owner_address, self.blinding]);
        hash([blinded_owner, token, token_id, self.amount, 1])
    }

    pub fn get_nullifier(self, owner_address: Field, token: Field, token_id: Field) -> Field {
        let secret_commitment = hash([owner_address, token, token_id, self.amount]);
        hash([self.chain_id, self.branch_root, self.branch_index, self.blinding, secret_commitment])
    }
}

pub struct OutputNote {
    pub chain_id: Field,
    pub recipient: Field,
    pub blinding: Field, // If 0, then assume recipient is already hashed with blinding
    pub amount: Field,
    pub transfer_type: u8, // 1: Transfer, 2: Withdrawal
}

pub impl OutputNote {
    pub fn from(chain_id: Field, recipient: Field, blinding: Field, amount: Field, transfer_type: u8) -> Self {
        Self { chain_id, recipient, blinding, amount, transfer_type }
    }

    pub fn get_recipient_hash(self) -> Field {
        if ((self.chain_id == 0) & (self.blinding == 0)) | (self.transfer_type == 2) {
            // If blinding is 0 and its a transfer, then assume recipient is already hashed with blinding
            // If its a withdrawal, then recipient should be Ethereum address and not hashed
            self.recipient
        } else {
            hash([self.chain_id, self.recipient, self.blinding])
        }
    }

    pub fn to_commitment(self, token: Field, token_id: Field) -> Field {
        let recipient_hash = self.get_recipient_hash();
        hash([recipient_hash, token, token_id, self.amount, self.transfer_type as Field])
    }
}

// Used for depositing from wormhole into shielded pool
pub struct WormholeNote<let M: u32> {
    pub dst_chain_id: Field, // destination chain id
    pub src_chain_id: Field, // source chain id
    pub entry_id: Field, // unique ID of wormhole entry in contract (hash of entry id + source chain id?)
    pub recipient: Field,
    pub wormhole_secret: Field,
    pub token: Field,
    pub token_id: Field,
    pub to: Field,
    pub from: Field,
    pub amount: Field,
    pub branch_index: Field,
    pub branch_siblings: [Field; M],
    pub branch_root: Field,
    pub master_index: Field,
    pub master_siblings: [Field; M],
    pub is_approved: bool,
    pub confidential_type: u8, // 0: None, 1: Partial, 2: Full
}

pub fn get_wormhole_pseudo_nullifier(chain_id: Field, address: Field, token: Field, token_id: Field, secret: Field) -> Field {
    let pseudo_commitment = hash([address, token, token_id, 0, 0]);
    hash([1, chain_id, secret, pseudo_commitment])
}

pub impl <let M: u32> WormholeNote<M> {
    fn from(dst_chain_id: Field, src_chain_id: Field, entry_id: Field, recipient: Field, wormhole_secret: Field, token: Field, token_id: Field, from: Field, to: Field, amount: Field, branch_index: Field, branch_siblings: [Field; M], branch_root: Field, master_index: Field, master_siblings: [Field; M], is_approved: bool, confidential_type: u8) -> Self {
        Self { dst_chain_id, src_chain_id, entry_id, recipient, wormhole_secret, token, token_id, from, to, amount, branch_index, branch_siblings, branch_root, master_index, master_siblings, is_approved, confidential_type }
    }

    pub fn get_burn_address(self) -> Field {
        if (self.confidential_type == 0) {
            let zk_wormhole = Field::from_be_bytes("ZKWORMHOLE".as_bytes());
            let hash = hash([self.dst_chain_id, self.recipient, self.wormhole_secret, zk_wormhole]);
            let hash_bytes: [u8; 32] = hash.to_be_bytes();
            let mut address_bytes: [u8; 20] = [0; 20];
            for i in 0..20 {
                address_bytes[i] = hash_bytes[12 + i];
            }
            Field::from_be_bytes(address_bytes)
        } else {
            self.to
        }
    }

    pub fn get_confidential_context(self) -> Field {
        if (self.confidential_type == 0) {
            0
        } else if (self.confidential_type == 1) {
            get_confidential_blinded_recipient_or_secret(true, self.recipient, self.wormhole_secret)
        } else {
            to_confidential_context(true, self.recipient, self.wormhole_secret, self.token, self.token_id, self.amount)
        }
    }

    pub fn to_burn_commitment(self) -> Field {
        let burn_address = self.get_burn_address();
        let confidential_context = self.get_confidential_context();
        let id_hash = hash([self.src_chain_id, self.entry_id]);
        let token_id = if (self.confidential_type == 2) { 0 } else { self.token_id };
        let amount = if (self.confidential_type == 2) { 0 } else { self.amount };
        hash([id_hash, self.is_approved as Field, self.from, burn_address, self.token, token_id, amount, confidential_context])
    }

    pub fn get_nullifier(self) -> Field {
        let id_hash = hash([self.src_chain_id, self.entry_id]);
        let secret_commitment = hash([self.recipient, self.token, self.token_id, self.from, self.amount]);
        hash([1, id_hash, self.wormhole_secret, secret_commitment])
    }
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

pub struct ConfidentialInputNote<let M: u32> {
    pub tree_id: Field,
    pub secret: Field,
    pub amount: Field,
    pub leaf_index: Field,
    pub leaf_path: [Field; M],
}

pub impl <let M: u32> ConfidentialInputNote<M> {
    pub fn from(tree_id: Field, secret: Field, amount: Field, leaf_index: Field, leaf_path: [Field; M]) -> Self {
        Self { tree_id, secret, amount, leaf_index, leaf_path }
    }

    pub fn to_commitment(self, from: Field, to: Field, token: Field, token_id: Field) -> Field {
        let confidential_context = to_confidential_context(false, to, self.secret, token, token_id, self.amount);
        hash([from, to, self.tree_id, confidential_context])
    }

    pub fn get_nullifier(self, from: Field, to: Field, token: Field, token_id: Field) -> Field {
        let secret_commitment = hash([from, to, token, token_id, self.amount]);
        hash([1, self.tree_id, self.leaf_index, self.secret, secret_commitment])
    }
}

pub struct ConfidentialOutputNote {
    pub wormhole_recipient: Option<Field>, // If exists, then confidential context is wormhole deposit
    pub amount: Field,
    pub secret: Field,
    pub transfer_type: u8, // 1: Transfer, 2: Withdrawal
}

pub impl ConfidentialOutputNote {
    pub fn from(wormhole_recipient: Option<Field>, amount: Field, secret: Field, transfer_type: u8) -> Self {
        Self { wormhole_recipient, amount, secret, transfer_type }
    }

    // Full commitment is [from, to, tree_id, confidential_context] hashed and inserted in smart contract
    pub fn to_confidential_context(self, token: Field, token_id: Field) -> Field {
        let is_wormhole = self.wormhole_recipient.is_some();
        let recipient = self.wormhole_recipient.unwrap_or(0);
        to_confidential_context(is_wormhole, recipient, self.secret, token, token_id, self.amount)
    }
}