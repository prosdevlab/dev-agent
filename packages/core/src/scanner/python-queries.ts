/**
 * Tree-sitter queries for Python code extraction.
 *
 * All queries validated against tree-sitter-python grammar via AST inspection.
 * Modeled after GO_QUERIES in go.ts.
 */

export const PYTHON_QUERIES = {
  // Top-level function definitions (not inside a class)
  functions: `
    (module
      (function_definition
        name: (identifier) @name) @definition)
  `,

  // Top-level decorated functions (e.g., @app.route, @pytest.fixture)
  decoratedFunctions: `
    (module
      (decorated_definition
        definition: (function_definition
          name: (identifier) @name)) @definition)
  `,

  // Class definitions
  classes: `
    (class_definition
      name: (identifier) @name) @definition
  `,

  // Method definitions (inside class body)
  methods: `
    (class_definition
      body: (block
        (function_definition
          name: (identifier) @name) @definition))
  `,

  // Decorated methods (inside class body)
  decoratedMethods: `
    (class_definition
      body: (block
        (decorated_definition
          definition: (function_definition
            name: (identifier) @name)) @definition))
  `,

  // Import statements
  imports: `
    (import_statement) @definition
  `,

  // From...import statements
  fromImports: `
    (import_from_statement) @definition
  `,

  // Module-level variable assignments (constants, config)
  moduleVariables: `
    (module
      (expression_statement
        (assignment
          left: (identifier) @name)) @definition)
  `,
};
