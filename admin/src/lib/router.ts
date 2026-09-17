import { useState, useEffect, useCallback } from 'preact/hooks';

export type Route =
  | 'login'
  | 'dashboard'
  | 'wifi'
  | 'devices'
  | 'settings'
  | 'wallet';

type Listener = () => void;

const listeners = new Set<Listener>();
let currentRoute: Route = 'dashboard';

const routeMap: Record<string, Route> = {
  '/login': 'login',
  '/': 'dashboard',
  '/wifi': 'wifi',
  '/devices': 'devices',
  '/settings': 'settings',
  '/wallet': 'wallet',
};

const reverseMap: Record<Route, string> = {
  login: '/login',
  dashboard: '/',
  wifi: '/wifi',
  devices: '/devices',
  settings: '/settings',
  wallet: '/wallet',
};

function parseHash(): Route {
  const hash = window.location.hash.replace('#', '') || '/';
  return routeMap[hash] || 'dashboard';
}

function notify() {
  listeners.forEach((l) => l());
}

export function navigate(route: Route) {
  const path = reverseMap[route] || '/';
  window.location.hash = path;
}

export function getRoute(): Route {
  return currentRoute;
}

export function useRoute(): Route {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return currentRoute;
}

export function initRouter() {
  currentRoute = parseHash();
  window.addEventListener('hashchange', () => {
    const next = parseHash();
    if (next !== currentRoute) {
      currentRoute = next;
      notify();
    }
  });
}
