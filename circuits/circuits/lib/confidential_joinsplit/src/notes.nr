use shared::{hash, to_confidential_context};

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