
use std::fmt;
use std::path::Path;
use std::rc::Rc;
use swc_common::errors::{ColorConfig, Handler};
use swc_common::{SourceMap, Span, Spanned};
use swc_ecma_ast::{self as ast, EsVersion};
use swc_ecma_parser::lexer::Lexer;
use swc_ecma_parser::{Parser, StringInput, Syntax, TsConfig};
use swc_ecma_visit::{Visit, VisitWith};

struct SpanDisplay(Rc<SourceMap>, Span);
impl fmt::Display for SpanDisplay {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let lo = self.0.lookup_char_pos(self.1.lo);
        let hi = self.0.lookup_char_pos(self.1.hi);
        write!(f, "{}:{}-{}:{}", lo.line, lo.col_display, hi.line, hi.col_display)
    }
}

struct Visitor {
    source_map: Rc<SourceMap>,
}
impl Visitor {
    fn display_span(&self, span: Span) -> SpanDisplay {
        SpanDisplay(self.source_map.clone(), span)
    }
}
impl Visit for Visitor {
    fn visit_fn_decl(&mut self, node: &ast::FnDecl) {
        println!("function {} at {}", node.ident.sym, self.display_span(node.function.span));
        VisitWith::visit_children_with(node, self);
    }
    fn visit_jsx_attr(&mut self, node: &ast::JSXAttr) {
        print!("jsx attribute {} at {}, ", match &node.name {
            ast::JSXAttrName::Ident(ident) => &ident.sym,
            ast::JSXAttrName::JSXNamespacedName(name) => &name.name.sym,
        }, self.display_span(node.span));
        if let Some(ast::JSXAttrValue::Lit(lit)) = &node.value {
            let (lo, hi) = (lit.span_lo(), lit.span_hi());
            let source_file = self.source_map.get_source_file(&self.source_map.span_to_filename(lit.span())).unwrap();
            let begin = char::from_u32(source_file.src.as_bytes()[lo.0 as usize - 1] as u32).unwrap();
            let end = char::from_u32(source_file.src.as_bytes()[hi.0 as usize - 2] as u32).unwrap();
            println!("begin quote {}, end quote {}", begin, end);
        } else {
            println!();
        }
    }
}

fn main() {
    let source_map: Rc<SourceMap> = Default::default();
    let handler = Handler::with_tty_emitter(ColorConfig::Auto, true, false, Some(source_map.clone()));

    let file_name = Path::new("index.tsx");
    let file_map = source_map.load_file(file_name).expect("failed to load file");
    let lexer = Lexer::new(
        Syntax::Typescript(TsConfig{ tsx: true, ..Default::default() }),
        EsVersion::EsNext,
        StringInput::from(&*file_map),
        None
    );

    let mut parser = Parser::new_from(lexer);

    for e in parser.take_errors() {
        e.into_diagnostic(&handler).emit();
    }

    let module = parser
        .parse_module()
        .map_err(|e| { e.into_diagnostic(&handler).emit() })
        .expect("failed to parse");
    let mut visitor = Visitor{ source_map };
    visitor.visit_module(&module);
}
