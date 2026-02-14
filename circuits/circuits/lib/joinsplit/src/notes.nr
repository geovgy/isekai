use poseidon::poseidon2::Poseidon2;

fn hash<let N: u32>(inputs: [Field; N]) -> Field {
    Poseidon2::hash(inputs, N)
}

// Verify merkle membership of leaf in leaf_root then leaf_root in master tree
pub struct InputNote<let M: u32> {
    pub chain_id: Field,
    pub blinding: Field,
    pub amount: Field,
    pub leaf_index: Field, // in shielded pool commitment tree
    pub leaf_siblings: [Field; M], // in shielded pool commitment tree
    pub leaf_root: Field, // in shielded pool commitment tree
    pub master_leaf_index: Field, // in shielded pool commitment tree
    pub master_leaf_siblings: [Field; M], // in shielded pool commitment tree
}

pub impl <let M: u32> InputNote<M> {
    pub fn from(chain_id: Field, blinding: Field, amount: Field, leaf_index: Field, leaf_siblings: [Field; M], leaf_root: Field, master_leaf_index: Field, master_leaf_siblings: [Field; M]) -> Self {
        Self { chain_id, blinding, amount, leaf_index, leaf_siblings, leaf_root, master_leaf_index, master_leaf_siblings }
    }

    pub fn to_commitment(self, owner_address: Field, asset_id: Field) -> Field {
        let blinded_owner = hash([self.chain_id, owner_address, self.blinding]);
        hash([blinded_owner, asset_id, self.amount, 1]) // Should always be a transfer as transfer type
    }

    pub fn get_nullifier(self, owner_address: Field, asset_id: Field) -> Field {
        let secret_commitment = hash([owner_address, asset_id, self.amount]);
        hash([self.chain_id, self.leaf_root, self.leaf_index, self.blinding, secret_commitment])
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

    pub fn to_commitment(self, asset_id: Field) -> Field {
        let recipient_hash = self.get_recipient_hash();
        hash([recipient_hash, asset_id, self.amount, self.transfer_type as Field])
    }
}

// Used for depositing from wormhole into shielded pool
pub struct WormholeNote {
    pub chain_id: Field,
    pub recipient: Field,
    pub wormhole_secret: Field,
    pub asset_id: Field,
    pub sender: Field,
    pub amount: Field,
    // leaf_index: Field, // in wormhole commitment tree  
    // leaf_siblings: [Field; M], // in wormhole commitment tree
}

pub fn get_wormhole_pseudo_nullifier(chain_id: Field, address: Field, asset_id: Field, secret: Field) -> Field {
    let pseudo_commitment = hash([address, asset_id, 0, 0]);
    hash([1, chain_id, secret, pseudo_commitment])
}

pub impl WormholeNote {
    fn from(chain_id: Field, recipient: Field, wormhole_secret: Field, asset_id: Field, sender: Field, amount: Field) -> Self {
        Self { chain_id, recipient, wormhole_secret, asset_id, sender, amount }
    }

    pub fn get_burn_address(self) -> Field {
        let zk_wormhole = Field::from_be_bytes("ZKWORMHOLE".as_bytes());
        let hash = hash([self.chain_id, self.recipient, self.wormhole_secret, zk_wormhole]);
        let hash_bytes: [u8; 32] = hash.to_be_bytes();
        let mut address_bytes: [u8; 20] = [0; 20];
        for i in 0..20 {
            address_bytes[i] = hash_bytes[12 + i];
        }
        Field::from_be_bytes(address_bytes)
    }

    pub fn to_burn_commitment(self, approved: bool) -> Field {
        let burn_address = self.get_burn_address();
        // Must match contract ordering: poseidon2(approved, sender, burn_address, assetId, amount)
        hash([approved as Field, self.sender, burn_address, self.asset_id, self.amount])
    }

    pub fn get_nullifier(self) -> Field {
        let secret_commitment = hash([self.recipient, self.asset_id, self.sender, self.amount]);
        hash([1, self.chain_id, self.wormhole_secret, secret_commitment])
    }
}