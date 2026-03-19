import { Component, OnInit, ViewEncapsulation } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthStore } from './auth.store';
import { ThemeStore } from './theme.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  encapsulation: ViewEncapsulation.None
})
export class App implements OnInit {
  ngOnInit(): void {
    const themeKey = AuthStore.themeKey();
    const mode = ThemeStore.load(themeKey);
    ThemeStore.apply(mode);
  }
}
