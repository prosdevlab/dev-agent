/**
 * Tree-sitter queries for Rust code extraction.
 *
 * All queries validated against tree-sitter-rust grammar via Step 0 tests.
 * Node names confirmed: function_item, struct_item, enum_item, trait_item,
 * impl_item (with type/trait fields), use_declaration, visibility_modifier.
 */

export const RUST_QUERIES = {
  // All function_item nodes at any depth (including inside mod blocks).
  // Methods inside impl blocks are filtered out in the scanner code
  // by checking if the parent is a declaration_list (impl body).
  functions: `
    (function_item
      name: (identifier) @name) @definition
  `,

  // Struct definitions
  structs: `
    (struct_item
      name: (type_identifier) @name) @definition
  `,

  // Enum definitions
  enums: `
    (enum_item
      name: (type_identifier) @name) @definition
  `,

  // Trait definitions
  traits: `
    (trait_item
      name: (type_identifier) @name) @definition
  `,

  // Methods inside impl blocks (captures receiver type + method name)
  implMethods: `
    (impl_item
      type: (_) @receiver
      body: (declaration_list
        (function_item
          name: (identifier) @name) @definition))
  `,

  // Use declarations (imports)
  imports: `
    (use_declaration) @definition
  `,

  // Type aliases
  typeAliases: `
    (type_item
      name: (type_identifier) @name) @definition
  `,
};
