//! Vérification à la main de l'impression native : une vraie application Tauri (fenêtre
//! cachée, WKWebView ou WebView2) rend des pages HTML en PDF.
//!
//! La boucle d'événements doit tourner sur le thread principal (macOS) : ce test se passe du
//! harnais de `cargo test` et ne fait rien sans `DAFTR_PRINT_PDF_OUT`, le dossier où écrire
//! les PDF.
//!
//! ```text
//! DAFTR_PRINT_PDF_OUT=/tmp/pdf cargo test -p adapter-print --test print_pdf
//! ```
//!
//! Pages rendues : `tests/fixtures/note.html` (plusieurs pages A4 : tableau, code coloré,
//! diagramme SVG), deux fois, pour vérifier que la fenêtre sert à plusieurs documents, puis
//! les fichiers HTML listés dans `DAFTR_PRINT_PDF_PAGES` (séparés par `:`).

use std::error::Error;
use std::path::PathBuf;

use adapter_print::WebviewPdfRenderer;
use app::ports::PdfRenderer;
use tauri::RunEvent;

const FIXTURE: &str = include_str!("fixtures/note.html");

fn main() -> Result<(), Box<dyn Error>> {
    let Some(output) = std::env::var_os("DAFTR_PRINT_PDF_OUT").map(PathBuf::from) else {
        println!("print_pdf: ignoré (DAFTR_PRINT_PDF_OUT absent)");
        return Ok(());
    };
    std::fs::create_dir_all(&output)?;
    let mut pages = vec![FIXTURE.to_owned(), FIXTURE.to_owned()];
    for path in std::env::var("DAFTR_PRINT_PDF_PAGES")
        .unwrap_or_default()
        .split(':')
        .filter(|path| !path.is_empty())
    {
        pages.push(std::fs::read_to_string(path)?);
    }

    let app =
        tauri::Builder::default().build(tauri::test::mock_context(tauri::test::noop_assets()))?;
    let handle = app.handle().clone();

    std::thread::spawn(move || {
        let renderer = WebviewPdfRenderer::new(handle.clone());
        let started = std::time::Instant::now();
        let result = renderer.render(&pages, &mut |done| {
            println!(
                "print_pdf: {done}/{} rendus ({:?})",
                pages.len(),
                started.elapsed()
            );
        });
        let code = match result {
            Ok(documents) => {
                let mut code = 0;
                for (index, pdf) in documents.iter().enumerate() {
                    let path = output.join(format!("note-{index}.pdf"));
                    if let Err(error) = std::fs::write(&path, pdf) {
                        eprintln!("print_pdf: {}: {error}", path.display());
                        code = 1;
                    }
                    println!("print_pdf: {} ({} octets)", path.display(), pdf.len());
                }
                code
            }
            Err(error) => {
                eprintln!("print_pdf: échec : {error}");
                1
            }
        };
        handle.exit(code);
    });

    app.run(|_, event| {
        // La fermeture de la fenêtre d'impression ne doit pas quitter avant la fin
        if let RunEvent::ExitRequested {
            api, code: None, ..
        } = event
        {
            api.prevent_exit();
        }
    });
    Ok(())
}
