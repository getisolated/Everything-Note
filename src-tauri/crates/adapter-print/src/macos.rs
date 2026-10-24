//! macOS : `-[WKWebView printOperationWithPrintInfo:]`, dont le travail est enregistré dans
//! un fichier (`NSPrintSaveJob`) sans panneau d'impression ni de progression.
//!
//! L'opération tourne en mode « feuille » sur la fenêtre (cachée) du webview : WebKit doit
//! laisser tourner la boucle principale pendant que le processus web pagine le document, ce
//! que `runOperation` (bloquant) ne permet pas. Sa fin arrive au délégué [`PrintDelegate`].

use std::cell::Cell;
use std::ffi::c_void;
use std::path::Path;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject};
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{
    NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob, NSPrintingPaginationMode,
};
use objc2_foundation::{NSObjectProtocol, NSPoint, NSRect, NSSize, NSURL};
use objc2_web_kit::WKWebView;
use tauri::webview::PlatformWebview;

use crate::PrintDone;
use crate::page::{HEIGHT_MM, MARGIN_MM, WIDTH_MM};

/// Points PostScript (unité de `NSPrintInfo`) par millimètre.
const POINTS_PER_MM: f64 = 72.0 / 25.4;

/// Lance l'impression ; appelé sur le thread principal (`with_webview`).
pub fn print(platform: &PlatformWebview, target: &Path, on_done: PrintDone) {
    let Some(mtm) = MainThreadMarker::new() else {
        on_done(Err("PDF printing must run on the main thread".into()));
        return;
    };
    // SAFETY: sur macOS, `PlatformWebview::inner` est le `WKWebView` de la fenêtre, vivant
    // pendant l'appel de `with_webview` ; `retain` le garde en vie au-delà (nul → `None`).
    let Some(webview) = (unsafe { Retained::retain(platform.inner().cast::<WKWebView>()) }) else {
        on_done(Err("the print window has no web view".into()));
        return;
    };
    let Some(window) = webview.window() else {
        on_done(Err("the print web view is not in a window".into()));
        return;
    };
    let Some(url) = NSURL::from_file_path(target) else {
        on_done(Err(format!("invalid PDF path: {}", target.display())));
        return;
    };

    let info = print_info(&url);
    // SAFETY: méthode de WebKit (macOS 11+, le minimum de l'app est 13), appelée sur le
    // thread principal avec un `NSPrintInfo` valide.
    let operation = unsafe { webview.printOperationWithPrintInfo(&info) };
    operation.setShowsPrintPanel(false);
    operation.setShowsProgressPanel(false);
    // Sans cadre, la vue d'impression de WebKit produit un PDF vide
    if let Some(view) = operation.view() {
        view.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), webview.frame().size));
    }

    let delegate = PrintDelegate::new(mtm, on_done);
    let delegate: &AnyObject = &delegate;
    // SAFETY: le sélecteur est celui de la méthode `printOperationDidRun:success:contextInfo:`
    // de `PrintDelegate`, de la signature attendue par AppKit ; le délégué se garde en vie
    // jusqu'à cet appel ; aucun `contextInfo` n'est passé (nul, jamais lu).
    unsafe {
        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            &window,
            Some(delegate),
            Some(sel!(printOperationDidRun:success:contextInfo:)),
            std::ptr::null_mut(),
        );
    }
}

/// Réglages : A4, marges du CSS `@page`, largeur ajustée à la page, fichier `url`.
fn print_info(url: &NSURL) -> Retained<NSPrintInfo> {
    let info = NSPrintInfo::new();
    let margin = MARGIN_MM * POINTS_PER_MM;

    info.setPaperSize(NSSize::new(
        WIDTH_MM * POINTS_PER_MM,
        HEIGHT_MM * POINTS_PER_MM,
    ));
    info.setTopMargin(margin);
    info.setBottomMargin(margin);
    info.setLeftMargin(margin);
    info.setRightMargin(margin);
    info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
    info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
    info.setHorizontallyCentered(true);
    info.setVerticallyCentered(false);
    // SAFETY: constantes d'AppKit, initialisées au chargement du framework et jamais modifiées.
    let (save_job, saving_url) = unsafe { (NSPrintSaveJob, NSPrintJobSavingURL) };
    info.setJobDisposition(save_job);
    // SAFETY: le dictionnaire mutable des attributs de `info`, qui le possède ; seules des
    // clés `NSString` et des valeurs objet y sont mises.
    let attributes = unsafe { info.dictionary() };
    // `NSPrintJobSavingURL` attend un `NSURL` (documentation de `NSPrintInfo`)
    let url: &AnyObject = url;
    attributes.insert(saving_url, url);
    info
}

/// État du délégué : la suite à donner, et le délégué lui-même tant que l'impression court
/// (AppKit ne retient pas le délégué d'une opération modale).
struct DelegateState {
    done: Cell<Option<PrintDone>>,
    keep_alive: Cell<Option<Retained<PrintDelegate>>>,
}

define_class!(
    // SAFETY: `NSObject` n'impose rien à ses sous-classes ; `PrintDelegate` n'implémente pas
    // `Drop` et ne vit que sur le thread principal (`MainThreadOnly`).
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "DaftrPdfPrintDelegate"]
    #[ivars = DelegateState]
    struct PrintDelegate;

    impl PrintDelegate {
        /// `didRunSelector` de `runOperationModalForWindow:delegate:didRunSelector:contextInfo:`.
        #[unsafe(method(printOperationDidRun:success:contextInfo:))]
        fn print_operation_did_run(
            &self,
            _operation: &NSPrintOperation,
            success: Bool,
            _context: *mut c_void,
        ) {
            if let Some(done) = self.ivars().done.take() {
                done(if success.as_bool() {
                    Ok(())
                } else {
                    Err("the system could not print the note".into())
                });
            }
            // Libéré à la vidange du pool courant, après le retour de cette méthode
            if let Some(this) = self.ivars().keep_alive.take() {
                let _ = Retained::autorelease_ptr(this);
            }
        }
    }

    unsafe impl NSObjectProtocol for PrintDelegate {}
);

impl PrintDelegate {
    fn new(mtm: MainThreadMarker, done: PrintDone) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(DelegateState {
            done: Cell::new(Some(done)),
            keep_alive: Cell::new(None),
        });
        // SAFETY: `init` de `NSObject` sur une instance allouée, aux variables initialisées.
        let this: Retained<Self> = unsafe { msg_send![super(this), init] };
        this.ivars().keep_alive.set(Some(this.clone()));
        this
    }
}
