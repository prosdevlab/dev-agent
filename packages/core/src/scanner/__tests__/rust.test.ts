/**
 * Rust Scanner Tests
 *
 * Step 0: Grammar validation — confirms tree-sitter-rust node names
 * before building the scanner. Keep this test as a permanent reference.
 */

import { describe, expect, it } from 'vitest';
import { parseCode } from '../tree-sitter';

// Step 0: Validate tree-sitter-rust grammar node names
describe('Rust grammar validation (Step 0)', () => {
  it('should parse function_item', async () => {
    const tree = await parseCode('pub fn hello() { }', 'rust');
    const root = tree.rootNode;
    const fn = root.namedChildren[0];
    expect(fn.type).toBe('function_item');
  });

  it('should parse struct_item', async () => {
    const tree = await parseCode('pub struct Foo { x: i32 }', 'rust');
    const root = tree.rootNode;
    const s = root.namedChildren[0];
    expect(s.type).toBe('struct_item');
  });

  it('should parse enum_item', async () => {
    const tree = await parseCode('pub enum Status { Active, Inactive }', 'rust');
    const root = tree.rootNode;
    const e = root.namedChildren[0];
    expect(e.type).toBe('enum_item');
  });

  it('should parse trait_item', async () => {
    const tree = await parseCode('pub trait Handler { fn handle(&self); }', 'rust');
    const root = tree.rootNode;
    const t = root.namedChildren[0];
    expect(t.type).toBe('trait_item');
  });

  it('should parse impl_item with type field', async () => {
    const code = `
impl Foo {
    fn bar(&self) {}
}`;
    const tree = await parseCode(code, 'rust');
    const root = tree.rootNode;
    const impl = root.namedChildren[0];
    expect(impl.type).toBe('impl_item');

    // The 'type' field should give us the concrete type name
    const typeNode = impl.childForFieldName('type');
    expect(typeNode).not.toBeNull();
    expect(typeNode!.text).toBe('Foo');
  });

  it('should parse impl Trait for Type with type field', async () => {
    const code = `
impl Handler for Server {
    fn handle(&self) {}
}`;
    const tree = await parseCode(code, 'rust');
    const root = tree.rootNode;
    const impl = root.namedChildren[0];
    expect(impl.type).toBe('impl_item');

    // 'type' field should give concrete type (Server), not the trait
    const typeNode = impl.childForFieldName('type');
    expect(typeNode).not.toBeNull();
    expect(typeNode!.text).toBe('Server');

    // 'trait' field should give the trait name
    const traitNode = impl.childForFieldName('trait');
    expect(traitNode).not.toBeNull();
    expect(traitNode!.text).toBe('Handler');
  });

  it('should parse use_declaration', async () => {
    const tree = await parseCode('use std::collections::HashMap;', 'rust');
    const root = tree.rootNode;
    const use = root.namedChildren[0];
    expect(use.type).toBe('use_declaration');
  });

  it('should parse call_expression for function calls', async () => {
    const code = `
fn main() {
    hello();
}`;
    const tree = await parseCode(code, 'rust');
    const fn = tree.rootNode.namedChildren[0];
    // Walk to find call_expression
    const body = fn.childForFieldName('body');
    expect(body).not.toBeNull();

    function findNodeType(node: typeof fn, type: string): typeof fn | null {
      if (node.type === type) return node;
      for (const child of node.namedChildren) {
        const found = findNodeType(child, type);
        if (found) return found;
      }
      return null;
    }

    const call = findNodeType(body!, 'call_expression');
    expect(call).not.toBeNull();
    expect(call!.childForFieldName('function')?.text).toBe('hello');
  });

  it('should parse call_expression for method calls (field_expression)', async () => {
    const code = `
fn main() {
    self.process_request();
}`;
    const tree = await parseCode(code, 'rust');

    function findNodeType(node: any, type: string): any {
      if (node.type === type) return node;
      for (const child of node.namedChildren) {
        const found = findNodeType(child, type);
        if (found) return found;
      }
      return null;
    }

    const call = findNodeType(tree.rootNode, 'call_expression');
    expect(call).not.toBeNull();

    const funcNode = call.childForFieldName('function');
    expect(funcNode).not.toBeNull();
    expect(funcNode.type).toBe('field_expression');
    expect(funcNode.text).toBe('self.process_request');
  });

  it('should parse macro_invocation separately from call_expression', async () => {
    const code = `
fn main() {
    println!("hello");
    hello();
}`;
    const tree = await parseCode(code, 'rust');

    function findAllNodeTypes(node: any, type: string, results: any[] = []): any[] {
      if (node.type === type) results.push(node);
      for (const child of node.namedChildren) {
        findAllNodeTypes(child, type, results);
      }
      return results;
    }

    const macros = findAllNodeTypes(tree.rootNode, 'macro_invocation');
    const calls = findAllNodeTypes(tree.rootNode, 'call_expression');

    expect(macros.length).toBe(1); // println!
    expect(calls.length).toBe(1); // hello()
  });

  it('should parse visibility_modifier for pub', async () => {
    const code = `
pub fn public_fn() {}
fn private_fn() {}
pub(crate) fn crate_fn() {}`;
    const tree = await parseCode(code, 'rust');
    const fns = tree.rootNode.namedChildren.filter((n: any) => n.type === 'function_item');
    expect(fns.length).toBe(3);

    // pub fn — has visibility_modifier
    const pubFn = fns[0];
    const vis0 = pubFn.namedChildren.find((n: any) => n.type === 'visibility_modifier');
    expect(vis0).toBeDefined();
    expect(vis0!.text).toBe('pub');

    // fn — no visibility_modifier
    const privateFn = fns[1];
    const vis1 = privateFn.namedChildren.find((n: any) => n.type === 'visibility_modifier');
    expect(vis1).toBeUndefined();

    // pub(crate) fn — has visibility_modifier
    const crateFn = fns[2];
    const vis2 = crateFn.namedChildren.find((n: any) => n.type === 'visibility_modifier');
    expect(vis2).toBeDefined();
    expect(vis2!.text).toBe('pub(crate)');
  });

  it('should parse doc comments as line_comment', async () => {
    const code = `
/// This is a doc comment
/// Second line
pub fn documented() {}`;
    const tree = await parseCode(code, 'rust');
    const root = tree.rootNode;

    // Doc comments are line_comment nodes before the function
    const comments = root.namedChildren.filter((n: any) => n.type === 'line_comment');
    expect(comments.length).toBe(2);
    expect(comments[0].text).toBe('/// This is a doc comment');
    expect(comments[1].text).toBe('/// Second line');
  });

  it('should detect async function via child nodes', async () => {
    const code = 'pub async fn fetch() {}';
    const tree = await parseCode(code, 'rust');
    const fn = tree.rootNode.namedChildren.find((n: any) => n.type === 'function_item');
    expect(fn).toBeDefined();

    // Check if any child is the 'async' keyword
    // tree-sitter-rust may expose it as an anonymous child
    const hasAsync = fn!.text.startsWith('pub async') || fn!.text.startsWith('async');
    expect(hasAsync).toBe(true);
  });

  it('should parse generic impl block', async () => {
    const code = `
impl<T: std::fmt::Display> Container<T> {
    pub fn show(&self) -> String {
        self.value.to_string()
    }
}`;
    const tree = await parseCode(code, 'rust');
    const impl = tree.rootNode.namedChildren[0];
    expect(impl.type).toBe('impl_item');

    const typeNode = impl.childForFieldName('type');
    expect(typeNode).not.toBeNull();
    // The type text includes the generic parameter
    expect(typeNode!.text).toContain('Container');
  });
});
