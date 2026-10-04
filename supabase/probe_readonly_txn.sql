-- READ ONLY. Is the read-only endpoint's session a read-only transaction?
SELECT current_setting('transaction_read_only') AS transaction_read_only, current_setting('default_transaction_read_only') AS default_transaction_read_only, version();
