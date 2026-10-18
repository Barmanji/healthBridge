"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import {
  signInSchema,
  signUpSchema,
  type SignUpValues,
} from "@/modules/auth/schemas";

type AuthFormProps =
  | { mode: "sign-in" }
  | { mode: "sign-up"; initialRole: "patient" | "doctor" };

export function AuthForm(props: AuthFormProps) {
  const router = useRouter();
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignIn = props.mode === "sign-in";
  const form = useForm<SignUpValues>({
    resolver: zodResolver(isSignIn ? signInSchema : signUpSchema) as unknown as Resolver<SignUpValues>,
    defaultValues: isSignIn
      ? { name: "", email: "", password: "", role: "patient" }
      : { name: "", email: "", password: "", role: props.initialRole },
    mode: "onBlur",
  });

  async function onSubmit(values: SignUpValues) {
    setRequestError(null);
    setIsSubmitting(true);
    try {
      if (isSignIn) {
        const result = await authClient.signIn.email({
          email: values.email,
          password: values.password,
        });
        if (result.error) {
          setRequestError("We could not sign you in. Check your details and try again.");
          return;
        }
      } else {
        const result = await authClient.signUp.email({
          name: values.name,
          email: values.email,
          password: values.password,
          role: values.role,
        });
        if (result.error) {
          setRequestError("We could not create your account. Check your details and try again.");
          return;
        }
      }
      router.replace("/");
      router.refresh();
    } catch {
      setRequestError("A connection problem stopped this request. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={form.handleSubmit((values) => onSubmit(values))}
    >
      {!isSignIn && (
        <Field>
          <FieldLabel htmlFor="name">Full name</FieldLabel>
          <Input id="name" autoComplete="name" maxLength={80} aria-invalid={Boolean(form.formState.errors.name)} {...form.register("name")} />
          <FieldError>{form.formState.errors.name?.message}</FieldError>
        </Field>
      )}

      <Field>
        <FieldLabel htmlFor="email">Email address</FieldLabel>
        <Input id="email" type="email" autoComplete="email" maxLength={254} aria-invalid={Boolean(form.formState.errors.email)} {...form.register("email")} />
        <FieldError>{form.formState.errors.email?.message}</FieldError>
      </Field>

      <Field>
        <FieldLabel htmlFor="password">Password</FieldLabel>
        <Input id="password" type="password" autoComplete={isSignIn ? "current-password" : "new-password"} minLength={8} maxLength={128} aria-invalid={Boolean(form.formState.errors.password)} {...form.register("password")} />
        <FieldError>{form.formState.errors.password?.message}</FieldError>
        {!isSignIn && <p className="text-sm text-muted-foreground">Use 8 to 128 characters.</p>}
      </Field>

      {!isSignIn && (
        <Field>
          <FieldLabel htmlFor="role">I am joining as</FieldLabel>
          <select
            id="role"
            className="h-10 w-full rounded-4xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            {...form.register("role")}
          >
            <option value="patient">Patient</option>
            <option value="doctor">Doctor applicant</option>
          </select>
        </Field>
      )}

      {requestError && <p className="text-sm text-destructive" role="alert">{requestError}</p>}
      <Button className="w-full" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Please wait…" : isSignIn ? "Sign in" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {isSignIn ? "New to Health-Bridge? " : "Already have an account? "}
        <Link className="font-semibold text-primary underline-offset-4 hover:underline" href={isSignIn ? "/sign-up" : "/sign-in"}>
          {isSignIn ? "Create an account" : "Sign in"}
        </Link>
      </p>
      {!isSignIn && <p className="text-center text-xs leading-relaxed text-muted-foreground">Doctor accounts begin as applications. Creating an account does not verify a medical license or grant access to patient records.</p>}
    </form>
  );
}
