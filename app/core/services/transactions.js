/* global angular, StellarSdk */

angular.module('app')
.factory('Transactions', function ($rootScope, Constellation, Signer, Storage, Wallet) {
	'use strict';

	let eventSource;
	const transactions = {};
	const transactionList = Storage.getItem('transactions') || [];
	transactionList.forEach(hash => {
		const data = Storage.getItem(`tx.${hash}`);
		data.tx = decodeTransaction(data.txenv);
		data.hash = hash;
		transactions[hash] = data;
	});

	subscribe();
	$rootScope.$on('account added', subscribe);

	return {
		addTransaction: addTransaction,
		forSigner: forSigner,
		get: getTransaction,
		isPending: isPending,
		markAsSigned: markAsSigned,
		subscribe: subscribe,
		list: transactionList
	};

	// ------------------------------------------------------------------------

	function addTransaction(hash, payload) {

		if (!(hash in transactions)) {
			transactions[hash] = payload;
			transactionList.push(hash);
			Storage.setItem('transactions', transactionList);
			payload.hash = hash;
			payload.signers = {};

			payload.id.forEach(id => {
				if (id !== Wallet.current.id) {
					Wallet.accounts[id].increaseBadgeCount();
				}
				payload.signers[id] = 1;
			});
			storeTransaction(hash, payload);
		}

		else {
			const tx = transactions[hash];
			payload.id.forEach(id => {
				tx.signers[id] = 1;
			});
			storeTransaction(hash, tx);
		}
	}

	function forSigner(signer) {
		return transactionList
		.map(hash => transactions[hash])
		.filter(tx => signer in tx.signers);
	}

	function getTransaction(hash) {
		return transactions[hash];
	}

	function isPending(txHash) {
		return txHash in transactions;
	}

	function markAsSigned(hash, signers) {
		const tx = transactions[hash];

		const hasSigned = tx.hasSigned || {};
		signers.forEach(id => {
			hasSigned[id] = 1;
		});

		tx.hasSigned = hasSigned;
		storeTransaction(hash, tx);
	}

	function subscribe() {
		const pubkeys = Wallet.accountList.map(account => account.id);
		eventSource = Constellation.subscribe(pubkeys, onRequest, onProgress, onAddSigner, onRemoveSigner);
	}

	// ------------------------------------------------------------------------

	function onAddSigner(payload) {

		if (payload.account in Wallet.accounts) {
			return;
		}

		const names = new Set(Wallet.accountList.map(item => item.alias));

		let name;
		let index = 1;
		while (true) {
			const candidate = `Shared Account #${index}`;
			if (!names.has(candidate)) {
				name = candidate;
				break;
			}
			index += 1;
		}

		Wallet.importAccount(payload.account, null, name, payload.network);
	}

	function onRemoveSigner(payload) {

		const account = Wallet.accounts[payload.account];
		if (account.network === payload.network) {
			Wallet.removeAccount(account);
		}
	}

	function onRequest(payload) {
		const tx = new StellarSdk.Transaction(payload.txenv);
		const hash = Signer.getTransactionHash(tx, payload.network).toString('hex');
		payload.tx = tx;
		addTransaction(hash, payload);
	}

	function onProgress(payload) {

		const hash = payload.hash;
		const isDone = Object.keys(payload.progress).every(key => {
			const account = payload.progress[key];
			return (account.weight >= account.threshold);
		});

		if (isDone) {
			const index = transactionList.indexOf(hash);
			transactionList.splice(index, 1);
			Storage.setItem('transactions', transactionList);

			delete transactions[hash];
			Storage.removeItem(`tx.${hash}`);
		}

		else {
			const tx = transactions[hash];
			tx.progress = payload.progress;
			storeTransaction(hash, tx);
		}
	}

	function storeTransaction(hash, tx) {
		const data = {
			txenv:		tx.txenv,
			network:	tx.network,
			progress:	tx.progress
		};

		if ('signers' in tx) {
			data.signers = tx.signers;
		}

		if ('hasSigned' in tx) {
			data.hasSigned = tx.hasSigned;
		}

		Storage.setItem(`tx.${hash}`, data);
	}

	function decodeTransaction(txenv) {
		return new StellarSdk.Transaction(txenv);
	}
});
