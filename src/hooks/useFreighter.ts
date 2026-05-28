import { useCallback, useEffect, useReducer } from "react";
import {
  isConnected,
  getPublicKey,
  getNetworkDetails,
  requestAccess,
  signTransaction,
  signAuthEntry,
  signBlob,
} from "@stellar/freighter-api";
import type { FreighterState, SignTransactionOptions, UseFreighterReturn } from "../types";

// ─── State Machine ─────────────────────────────────────────────────────────────

type Action =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_CONNECTED"; publicKey: string; network: string; networkPassphrase: string }
  | { type: "SET_DISCONNECTED" }
  | { type: "SET_NOT_INSTALLED" }
  | { type: "SET_ERROR"; payload: Error };

function reducer(state: FreighterState, action: Action): FreighterState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, isLoading: action.payload, error: null };
    case "SET_CONNECTED":
      return {
        ...state,
        isInstalled: true,
        isConnected: true,
        publicKey: action.publicKey,
        network: action.network,
        networkPassphrase: action.networkPassphrase,
        isLoading: false,
        error: null,
      };
    case "SET_DISCONNECTED":
      return {
        ...state,
        isConnected: false,
        publicKey: null,
        network: null,
        networkPassphrase: null,
        isLoading: false,
        error: null,
      };
    case "SET_NOT_INSTALLED":
      return { ...state, isInstalled: false, isLoading: false };
    case "SET_ERROR":
      return { ...state, isLoading: false, error: action.payload };
    default:
      return state;
  }
}

const initial: FreighterState = {
  isInstalled: false,
  isConnected: false,
  publicKey: null,
  network: null,
  networkPassphrase: null,
  isLoading: true,
  error: null,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Connect to and interact with the Freighter browser wallet.
 *
 * @example
 * ```tsx
 * const { isConnected, publicKey, connect } = useFreighter();
 *
 * if (!isConnected) return <button onClick={connect}>Connect Wallet</button>;
 * return <p>Connected: {publicKey}</p>;
 * ```
 */
export function useFreighter(): UseFreighterReturn {
  const [state, dispatch] = useReducer(reducer, initial);

  // Probe on mount — detect whether Freighter is installed and already authorised
  useEffect(() => {
    let cancelled = false;

    async function probe() {
      dispatch({ type: "SET_LOADING", payload: true });

      try {
        // isConnected() returns Promise<boolean> in @stellar/freighter-api@2.0.0
        const connected = await isConnected();
        if (cancelled) return;

        if (!connected) {
          dispatch({ type: "SET_NOT_INSTALLED" });
          return;
        }

        // getPublicKey() throws if the user has not yet granted access —
        // treat that as "installed but not yet connected".
        try {
          const publicKey = await getPublicKey();
          if (cancelled) return;

          if (publicKey) {
            const networkDetails = await getNetworkDetails();
            if (cancelled) return;

            dispatch({
              type: "SET_CONNECTED",
              publicKey,
              network: networkDetails.network,
              networkPassphrase: networkDetails.networkPassphrase,
            });
          } else {
            dispatch({ type: "SET_DISCONNECTED" });
          }
        } catch {
          if (!cancelled) dispatch({ type: "SET_DISCONNECTED" });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "SET_ERROR",
            payload: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    }

    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    dispatch({ type: "SET_LOADING", payload: true });
    try {
      // requestAccess() returns the public key string on success
      const publicKey = await requestAccess();
      if (!publicKey) {
        throw new Error("Freighter access denied or no account selected");
      }
      const networkDetails = await getNetworkDetails();
      dispatch({
        type: "SET_CONNECTED",
        publicKey,
        network: networkDetails.network,
        networkPassphrase: networkDetails.networkPassphrase,
      });
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        payload: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    dispatch({ type: "SET_DISCONNECTED" });
  }, []);

  const signTx = useCallback(
    async (xdr: string, opts?: SignTransactionOptions): Promise<string> => {
      // Freighter API v2 uses accountToSign; our public type exposes it as `address`
      return signTransaction(xdr, {
        networkPassphrase: opts?.networkPassphrase,
        accountToSign: opts?.address,
      });
    },
    [],
  );

  const signEntry = useCallback(
    async (entryPreimageXdr: string): Promise<string> => {
      return signAuthEntry(entryPreimageXdr);
    },
    [],
  );

  const signBlobCallback = useCallback(
    async (blob: string, opts?: { accountToSign?: string }): Promise<string> => {
      return signBlob(blob, opts);
    },
    [],
  );

  return {
    ...state,
    connect,
    disconnect,
    signTransaction: signTx,
    signAuthEntry: signEntry,
    signBlob: signBlobCallback,
  };
}
