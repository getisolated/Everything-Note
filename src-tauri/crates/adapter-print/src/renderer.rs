//! Rendu PDF par une fenêtre cachée : chaque page est écrite dans un fichier temporaire du
//! cache de l'app, chargée, imprimée vers un PDF temporaire, puis relue. Une seule fenêtre
//! sert pour toutes les pages d'un export ; elle est détruite à la fin.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use app::ports::PdfRenderer;
use app::{AppError, AppResult};
use platform::sync::lock;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Étiquette de la fenêtre d'impression (hors des capacités : aucune commande IPC permise).
pub const PRINT_WINDOW: &str = "print";
/// Sous-dossier du cache de l'app où passent les pages et les PDF d'un export.
const WORK_DIRECTORY: &str = "pdf-export";
/// Taille de la fenêtre : la mise en page imprimée ne dépend que du format de papier.
const WINDOW_SIZE: (f64, f64) = (900.0, 1200.0);
/// Délai laissé à WebKit / Chromium après le chargement pour finir la mise en page (polices,
/// SVG des diagrammes) avant d'imprimer.
const LAYOUT_DELAY: Duration = Duration::from_millis(300);
/// Au-delà, une page qui ne se charge pas fait échouer l'export.
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
/// Au-delà, une impression qui ne se termine pas fait échouer l'export.
const PRINT_TIMEOUT: Duration = Duration::from_secs(120);

/// Rendu PDF par impression native d'un webview caché.
pub struct WebviewPdfRenderer {
    app: AppHandle,
    /// Un export à la fois : la fenêtre d'impression et le dossier de travail sont uniques.
    busy: Mutex<()>,
}

impl WebviewPdfRenderer {
    /// Rendu branché sur l'application (fenêtres, dossier de cache).
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            busy: Mutex::new(()),
        }
    }

    fn work_directory(&self) -> Result<PathBuf, String> {
        let directory = self
            .app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?
            .join(WORK_DIRECTORY);

        // Restes d'un export interrompu
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        Ok(directory)
    }

    fn render_all(
        &self,
        directory: &Path,
        pages: &[String],
        rendered: &mut dyn FnMut(usize),
    ) -> Result<Vec<Vec<u8>>, String> {
        let window = PrintWindow::open(&self.app)?;
        let mut documents = Vec::with_capacity(pages.len());

        for (index, html) in pages.iter().enumerate() {
            documents.push(window.render(directory, index, html)?);
            rendered(index + 1);
        }
        Ok(documents)
    }
}

impl PdfRenderer for WebviewPdfRenderer {
    fn render(&self, pages: &[String], rendered: &mut dyn FnMut(usize)) -> AppResult<Vec<Vec<u8>>> {
        if pages.is_empty() {
            return Ok(Vec::new());
        }
        let _busy = lock(&self.busy);

        let result = self.work_directory().and_then(|directory| {
            let documents = self.render_all(&directory, pages, rendered);
            let _ = std::fs::remove_dir_all(&directory);
            documents
        });
        result.map_err(|message| {
            tracing::warn!(%message, "export PDF en échec");
            AppError::file_system(format!("PDF export failed: {message}"))
        })
    }
}

/// La fenêtre cachée et les fins de chargement de ses pages ; détruite quand on la lâche.
struct PrintWindow {
    window: WebviewWindow,
    loaded: Receiver<Url>,
}

impl PrintWindow {
    fn open(app: &AppHandle) -> Result<Self, String> {
        // Une fenêtre laissée par un export interrompu
        if let Some(stale) = app.get_webview_window(PRINT_WINDOW) {
            let _ = stale.destroy();
        }
        let blank = Url::parse("about:blank").map_err(|error| error.to_string())?;
        let (sender, loaded) = mpsc::channel();

        let window = WebviewWindowBuilder::new(app, PRINT_WINDOW, WebviewUrl::External(blank))
            .title("Daftr PDF")
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .inner_size(WINDOW_SIZE.0, WINDOW_SIZE.1)
            .on_page_load(move |_, payload| {
                if payload.event() == PageLoadEvent::Finished {
                    let _ = sender.send(payload.url().clone());
                }
            })
            .build()
            .map_err(|error| format!("print window: {error}"))?;
        Ok(Self { window, loaded })
    }

    /// Charge la page `html`, l'imprime, rend les octets du PDF.
    fn render(&self, directory: &Path, index: usize, html: &str) -> Result<Vec<u8>, String> {
        let name = format!("note-{index}");
        let page = directory.join(format!("{name}.html"));
        let pdf = directory.join(format!("{name}.pdf"));

        std::fs::write(&page, html).map_err(|error| error.to_string())?;
        let url = Url::from_file_path(&page)
            .map_err(|()| format!("invalid page path: {}", page.display()))?;

        // Fins de chargement d'une page précédente, sans objet ici
        while self.loaded.try_recv().is_ok() {}
        self.window
            .navigate(url)
            .map_err(|error| error.to_string())?;
        self.wait_for_load(&format!("{name}.html"))?;
        std::thread::sleep(LAYOUT_DELAY);

        self.print(&pdf)?;
        let bytes = std::fs::read(&pdf).map_err(|error| error.to_string())?;
        if !bytes.starts_with(b"%PDF") {
            return Err("the printed file is not a PDF".into());
        }
        Ok(bytes)
    }

    /// Attend la fin du chargement du fichier `file_name`.
    fn wait_for_load(&self, file_name: &str) -> Result<(), String> {
        let deadline = Instant::now() + LOAD_TIMEOUT;

        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.loaded.recv_timeout(remaining) {
                Ok(url) if last_segment(&url) == Some(file_name) => return Ok(()),
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => {
                    return Err("the note did not load in time".into());
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("the print window was closed".into());
                }
            }
        }
    }

    fn print(&self, target: &Path) -> Result<(), String> {
        let (sender, done) = mpsc::channel();

        crate::print_to_pdf(
            &self.window,
            target,
            Box::new(move |result| {
                let _ = sender.send(result);
            }),
        )?;
        match done.recv_timeout(PRINT_TIMEOUT) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => Err("printing timed out".into()),
            // La suite a été lâchée sans être appelée : l'impression n'a pas eu lieu
            Err(RecvTimeoutError::Disconnected) => Err("printing was interrupted".into()),
        }
    }
}

impl Drop for PrintWindow {
    fn drop(&mut self) {
        if let Err(error) = self.window.destroy() {
            tracing::warn!(%error, "fenêtre d'impression non fermée");
        }
    }
}

fn last_segment(url: &Url) -> Option<&str> {
    url.path_segments()?.next_back()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_the_loaded_page_by_its_file_name() {
        let url = Url::parse("file:///Users/a%20b/Caches/pdf-export/note-3.html").unwrap();

        assert_eq!(last_segment(&url), Some("note-3.html"));
        assert_eq!(last_segment(&Url::parse("about:blank").unwrap()), None);
    }
}
