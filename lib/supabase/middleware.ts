import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicAuthPath } from "@/lib/auth/onboarding";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = isPublicAuthPath(request.nextUrl.pathname);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    // A portal route sends the visitor to the portal sign-in explanation
    // instead of the organization login form.
    url.pathname = request.nextUrl.pathname.startsWith("/portal") ? "/portal/login" : "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
