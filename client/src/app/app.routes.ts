import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('@pages/home/home').then((m) => m.Home),
  },
  {
    path: 'game/:token',
    loadComponent: () => import('@pages/game/game').then((m) => m.Game),
  },
  { path: '**', redirectTo: '' },
];
