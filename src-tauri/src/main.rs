// Évite d'ouvrir une console noire sous Windows en version finale.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    onde_lib::run()
}
