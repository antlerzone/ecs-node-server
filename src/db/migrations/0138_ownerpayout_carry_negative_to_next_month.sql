-- When operator marks owner payout as paid with negative netpayout,
-- they can choose whether to carry that negative balance into next month.
ALTER TABLE ownerpayout
  ADD COLUMN carry_negative_to_next_month TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Carry negative netpayout into next month balance deduction';

