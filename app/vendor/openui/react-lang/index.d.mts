import { ACTION_STEPS, ActionEvent, ActionPlan, ActionPlan as ActionPlan$1, ActionRef, ActionStep, BuildMessageInput, BuiltinActionType, ComponentGroup, ComponentPromptSpec, ComponentRenderProps as ComponentRenderProps$1, DefinedAction, DefinedAction as DefinedAction$1, DefinedComponent as DefinedComponent$1, DefinedFunction, ElementNode, EvaluationContext, InferStateFieldValue, Library as Library$1, LibraryActionEvent, LibraryActionEvent as LibraryActionEvent$1, LibraryDefinition as LibraryDefinition$1, LibraryExtension as LibraryExtension$1, McpClientLike, McpClientLike as McpClientLike$1, OpenUIError, OpenUIError as OpenUIError$1, ParseMessageOptions, ParseResult, ParseResult as ParseResult$1, ParsedMessage, ParsedRule, ParsedRule as ParsedRule$1, PromptOptions, PromptSpec, ReactiveAssign, StateField, StateField as StateField$1, SubComponentOf, SystemPromptOptions, SystemPromptSpec, ToolDescriptor, ToolNotFoundError, ToolProvider, ToolSpec, ValidatorFn, action, buildMessage, builtInValidators, createParser, createStreamingParser, defineAction, defineFunction, extractToolResult, generatePrompt, generateSystemPrompt, isReactiveAssign, mergeStatements, parseMessage, parseRules, parseStructuredRules, steps, tagSchemaId, validate } from "@openuidev/lang-core";
import * as _$react from "react";
import React$1, { ComponentPropsWithRef, ReactNode } from "react";
import { z } from "zod/v4";
import { $ZodObject } from "zod/v4/core";

//#region src/library.d.ts
interface ComponentRenderProps<P = Record<string, unknown>> extends ComponentRenderProps$1<P, ReactNode> {}
type ComponentRenderer<P = Record<string, unknown>> = React.FC<ComponentRenderProps<P>>;
type DefinedComponent<T extends $ZodObject = $ZodObject> = DefinedComponent$1<T, ComponentRenderer<z.infer<T>>>;
type AnyAction = DefinedAction$1<any, string>;
type Library<A extends AnyAction = AnyAction> = Library$1<ComponentRenderer<any>, A>;
type LibraryDefinition<A extends AnyAction = AnyAction> = LibraryDefinition$1<ComponentRenderer<any>, A>;
type LibraryExtension<A extends AnyAction = AnyAction> = LibraryExtension$1<ComponentRenderer<any>, A>;
declare function defineComponent<T extends $ZodObject>(config: {
  name: string;
  props: T;
  description: string;
  component: ComponentRenderer<z.infer<T>>;
}): DefinedComponent<T>;
declare function createLibrary<A extends AnyAction = never>(input: LibraryDefinition<A>): Required<Library<A>>;
//#endregion
//#region src/components/index.d.ts
type ViewProps = ComponentPropsWithRef<"div"> & {
  /** Fades content while queries load. Omit to leave opacity untouched. */dimmed?: boolean;
};
type ButtonProps = ComponentPropsWithRef<"button">;
type SectionProps = ComponentPropsWithRef<"section">;
//#endregion
//#region src/Renderer.d.ts
interface RendererQueryState {
  /** Whether any query is waiting for generation or fetching data. */
  isLoading: boolean;
  errors: OpenUIError$1[];
  retry: () => void;
  isRetrying: boolean;
}
interface RendererProps<L extends Library = Library> {
  /** Raw response: openui-lang code, or a stored message with protocol markers (see buildMessage). */
  response: string | null;
  /** Component library from createLibrary(). */
  library: L;
  /** Whether the LLM is still streaming (form interactions disabled during streaming). */
  isStreaming?: boolean;
  /** Callback when a component triggers an action. Typed by the library's custom actions. */
  onAction?: (event: LibraryActionEvent$1<L>) => void;
  /**
   * Called whenever a form field value changes. Receives the raw form state map.
   * The consumer decides how to persist this (e.g. embed in message, store separately).
   */
  onStateUpdate?: (state: Record<string, unknown>) => void;
  /**
   * Initial form state to hydrate on load (e.g. from a previously persisted message).
   * Shape: { formName: { fieldName: { value, componentType } }, $varName: value }
   * $-prefixed keys are treated as reactive bindings, everything else is form state.
   */
  initialState?: Record<string, any>;
  /** Called whenever the parse result changes. */
  onParseResult?: (result: ParseResult$1 | null) => void;
  /**
   * Tool provider for Query()/Mutation() calls.
   * - Function map: `{ tool_name: async (args) => result }` — simplest option
   * - MCP client: any object with `callTool({ name, arguments })` (e.g. from @modelcontextprotocol/sdk)
   */
  toolProvider?: Record<string, (args: Record<string, unknown>) => Promise<unknown>> | McpClientLike$1 | null;
  /** Custom loading indicator. Defaults to a spinner. */
  queryLoader?: React$1.ReactNode;
  /** Custom slot composition. Omit to keep content visible with a loading indicator. */
  children?: React$1.ReactNode;
  /**
   * Called with structured, LLM-friendly errors from the parser and query system.
   * Includes generation errors (unknown components, missing required props)
   * and tool execution failures. Retry data-source failures instead of treating
   * every query error as a reason to regenerate the program.
   * Can include warnings (`severity: "warning"`) for programs that still render.
   * Called with [] when all errors are resolved.
   */
  onError?: (errors: OpenUIError$1[]) => void;
  publishObservability?: boolean;
}
declare function RendererRoot<L extends Library = Library>({
  response,
  library,
  isStreaming,
  onAction,
  onStateUpdate,
  initialState,
  onParseResult,
  toolProvider,
  queryLoader,
  children,
  onError,
  publishObservability
}: RendererProps<L>): React$1.JSX.Element;
/** Access query loading, failures, and retry within the nearest Renderer root. */
declare function useRendererQuery(): RendererQueryState;
type RendererContentSlotProps = Omit<ViewProps, "children" | "dimmed">;
/** Displays generated content, preserving mounted components while queries load or fail. */
declare function RendererContent({
  hidden,
  ...props
}: RendererContentSlotProps): React$1.JSX.Element | null;
interface RendererSlotProps {
  children?: React$1.ReactNode;
}
/** Shows query loading feedback, except while a query failure is being displayed. */
declare function RendererQueryLoading({
  children
}: RendererSlotProps): React$1.JSX.Element | null;
/** Shows the supplied content when queries fail; renders nothing without children. */
declare function RendererQueryError({
  children
}: RendererSlotProps): React$1.JSX.Element | null;
type RendererRetryProps = ButtonProps;
declare function RendererRetry({
  disabled,
  ...props
}: RendererRetryProps): React$1.JSX.Element;
declare function DefaultRenderer<L extends Library = Library>({
  children,
  ...props
}: RendererProps<L>): React$1.JSX.Element;
/** Render with the default presentation, or compose slots around one shared runtime. */
declare const Renderer: typeof DefaultRenderer & {
  Root: typeof RendererRoot;
  Content: typeof RendererContent;
  QueryLoading: typeof RendererQueryLoading;
  QueryError: typeof RendererQueryError;
  Retry: typeof RendererRetry;
};
//#endregion
//#region src/context.d.ts
/**
 * Get the renderNode function for rendering nested component values.
 */
declare function useRenderNode(): (value: unknown) => ReactNode;
/**
 * Get the triggerAction function for firing structured action events.
 *
 * @example
 * ```tsx
 * const triggerAction = useTriggerAction();
 * <button onClick={() => triggerAction("Submit", "myForm")}>
 * ```
 */
declare function useTriggerAction(): (userMessage: string, formName?: string, action?: ActionPlan$1 | {
  type?: string;
  params?: Record<string, any>;
}) => void | Promise<void>;
/**
 * Whether the LLM is currently streaming content.
 */
declare function useIsStreaming(): boolean;
/**
 * Whether any Query is currently fetching data.
 * Useful for showing skeleton/loading states in data-driven components.
 */
declare function useIsQueryLoading(): boolean;
/**
 * Get a form field value from the form state context.
 *
 * @example
 * ```tsx
 * const getFieldValue = useGetFieldValue();
 * const name = getFieldValue("contactForm", "name");
 * ```
 */
declare function useGetFieldValue(): (formName: string | undefined, name: string) => any;
/**
 * Get the setFieldValue function for updating form field values.
 *
 * @example
 * ```tsx
 * const setFieldValue = useSetFieldValue();
 * <input onChange={(e) => setFieldValue("contactForm", "Input", "name", e.target.value, false)} />
 * ```
 */
declare function useSetFieldValue(): (formName: string | undefined, componentType: string | undefined, name: string, value: unknown, shouldTriggerSaveCallback?: boolean) => void;
declare const FormNameContext: _$react.Context<string | undefined>;
/**
 * Get the current form name (set by the nearest parent Form component).
 * Returns undefined if not inside a Form.
 */
declare function useFormName(): string | undefined;
/**
 * Persists a component's default/initial value into form state once streaming
 * finishes — but only if the user hasn't already set a value.
 *
 * Call this inside any form component that has a `defaultValue` or
 * `defaultChecked` prop. It is a no-op during streaming so that LLM
 * prop changes don't fight with partial state.
 *
 * @param shouldTriggerSaveCallback — defaults to `false` (only local state, no message persistence)
 */
declare function useSetDefaultValue({
  formName,
  componentType,
  name,
  existingValue,
  defaultValue,
  shouldTriggerSaveCallback
}: {
  formName?: string;
  componentType?: string;
  name: string;
  existingValue: unknown;
  defaultValue: unknown;
  shouldTriggerSaveCallback?: boolean;
}): void;
//#endregion
//#region src/runtime/reactive.d.ts
/**
 * Mark a schema prop as reactive so runtime evaluation can preserve $bindings.
 *
 * The widened return type carries the eventual value shape into helpers like
 * `useStateField()`. The actual bound value is still resolved at render time.
 */
declare function reactive<T extends z.ZodType>(schema: T): z.ZodType<StateField$1<z.infer<T>>>;
//#endregion
//#region src/hooks/useStateField.d.ts
declare function useStateField<T = unknown>(name: string, value?: T): StateField$1<InferStateFieldValue<T>>;
//#endregion
//#region src/hooks/useFormValidation.d.ts
interface FormValidationContextValue {
  errors: Record<string, string | undefined>;
  getFieldError: (name: string) => string | undefined;
  validateField: (name: string, value: unknown, rules: ParsedRule$1[]) => boolean;
  registerField: (name: string, rules: ParsedRule$1[], getValue: () => unknown) => void;
  unregisterField: (name: string) => void;
  validateForm: () => boolean;
  clearFieldError: (name: string) => void;
}
declare const FormValidationContext: _$react.Context<FormValidationContextValue | null>;
declare function useFormValidation(): FormValidationContextValue | null;
declare function useCreateFormValidation(): FormValidationContextValue;
//#endregion
//#region src/responseBundle.d.ts
/** Metadata emitted by OpenUI Cloud. */
interface ResponseMetadata {
  name?: string;
}
//#endregion
//#region src/WithPreviewRenderer.d.ts
interface RendererPreviewState {
  metadata: ResponseMetadata;
  isOpen: boolean;
  isStreaming: boolean;
  /** ID of the expanded content region. */
  contentId: string;
  open: () => void;
  close: () => void;
}
interface WithPreviewRendererProps extends RendererProps {
  /** Controlled visibility. Omit to use internal state. */
  open?: boolean;
  /** Initial visibility when uncontrolled. Defaults to false. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Metadata belongs to the preview presentation, not the underlying Renderer. */
  onMetadata?: (metadata: ResponseMetadata) => void;
  /** Compose Trigger, Content, and Close. Omit for the default preview and panel. */
  children?: React.ReactNode;
}
/** Read metadata and control the nearest preview. Available even while its content is closed. */
declare function useRendererPreview(): RendererPreviewState;
declare function PreviewRoot({
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
  onMetadata,
  children,
  ...rendererProps
}: WithPreviewRendererProps): _$react.JSX.Element;
type PreviewButtonProps = ButtonProps;
declare function PreviewTrigger({
  children,
  ...props
}: PreviewButtonProps): _$react.JSX.Element;
declare function PreviewClose({
  children,
  ...props
}: PreviewButtonProps): _$react.JSX.Element;
type PreviewContentProps = SectionProps;
/** Mount one content slot per preview. Query hooks and Renderer slots belong inside it. */
declare function PreviewContent({
  children,
  ...props
}: PreviewContentProps): _$react.JSX.Element | null;
declare function DefaultWithPreviewRenderer({
  children,
  ...props
}: WithPreviewRendererProps): _$react.JSX.Element;
/** Adds a preview and expandable content. Use Renderer for a directly visible interface. */
declare const WithPreviewRenderer: typeof DefaultWithPreviewRenderer & {
  Root: typeof PreviewRoot;
  Trigger: typeof PreviewTrigger;
  Content: typeof PreviewContent;
  Close: typeof PreviewClose;
};
//#endregion
export { ACTION_STEPS, type ActionEvent, type ActionPlan, type ActionRef, type ActionStep, type BuildMessageInput, BuiltinActionType, type ComponentGroup, type ComponentPromptSpec, type ComponentRenderProps, type ComponentRenderer, type DefinedAction, type DefinedComponent, type DefinedFunction, type ElementNode, type EvaluationContext, FormNameContext, FormValidationContext, type FormValidationContextValue, type Library, type LibraryActionEvent, type LibraryDefinition, type LibraryExtension, type McpClientLike, type OpenUIError, type ParseMessageOptions, type ParseResult, type ParsedMessage, type ParsedRule, type PreviewButtonProps, type PreviewContentProps, type PromptOptions, type PromptSpec, type ReactiveAssign, Renderer, type RendererContentSlotProps, type RendererPreviewState, type RendererProps, type RendererQueryState, type RendererRetryProps, type RendererSlotProps, type ResponseMetadata, type StateField, type SubComponentOf, type SystemPromptOptions, type SystemPromptSpec, type ToolDescriptor, ToolNotFoundError, type ToolProvider, type ToolSpec, type ValidatorFn, WithPreviewRenderer, type WithPreviewRendererProps, action, buildMessage, builtInValidators, createLibrary, createParser, createStreamingParser, defineAction, defineComponent, defineFunction, extractToolResult, generatePrompt, generateSystemPrompt, isReactiveAssign, mergeStatements, parseMessage, parseRules, parseStructuredRules, reactive, steps, tagSchemaId, useCreateFormValidation, useFormName, useFormValidation, useGetFieldValue, useIsQueryLoading, useIsStreaming, useRenderNode, useRendererPreview, useRendererQuery, useSetDefaultValue, useSetFieldValue, useStateField, useTriggerAction, validate };
