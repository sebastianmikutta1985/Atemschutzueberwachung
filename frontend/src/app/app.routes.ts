import { Routes } from '@angular/router';
import { DashboardPage } from './dashboard.page';
import { SettingsPage } from './settings.page';

export const routes: Routes = [
  { path: '', component: DashboardPage },
  { path: 'einstellungen', component: SettingsPage },
  { path: '**', redirectTo: '' }
];
