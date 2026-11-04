# Design brief: MyTerra home page (2027 edition)

Use this as the prompt for any design work on the public home page.

## The prompt
> Redesign the MyTerra public home page as a senior product designer would for a 2027 launch.
> MyTerra is a home fibre internet provider in Lebanon. The page has three jobs, in order:
> 1. turn visitors into applicants (Apply now),
> 2. get existing customers into their account fast (Sign in),
> 3. build trust (real plans, live network status, real people using the internet at home).
>
> Keep MyTerra's identity: pine green #1d6b58 / deep pine #134a3d, amber #f0ad3a, Bricolage Grotesque headlines,
> Source Sans 3 body, IBM Plex Sans Arabic for Arabic. One bold idea per page; everything else quiet.
>
> Must have:
> - **Hero**: headline + one-line promise, Apply and Sign in, live network status pill, a real lifestyle photo,
>   and one honest data point from the real plans (top speed). One motion only: the light along the fibre line.
> - **Photo carousel** "Made for how you live": real photos (streaming, family video calls abroad, working
>   from home, gaming, free router + installation). Swipe on touch, drag with the mouse, arrows, dots,
>   keyboard; snaps to slides; works right-to-left in Arabic; lazy-loaded images with fixed sizes.
> - **Plan finder**: people at home + what they do online → recommends the cheapest real plan that fits,
>   explains why in one sentence, and links to sign-up with that plan already chosen.
> - **Plans** from the database, "Best value per GB" computed, never invented.
> - **What your account does**, **three steps**, **questions**, **final call to action**, **footer** with photo credit.
>
> Rules: real data only (no fake stats, reviews or logos); plain words, sentence case, no all-caps labels;
> works at 320–1920 px with no sideways scrolling; WCAG 2.2 AA (contrast, focus, labels, reduced motion);
> English, Arabic (right-to-left) and French for every text; images self-hosted as WebP under 150 KB;
> nothing that breaks the strict security policy (no HTML injection, no third-party scripts).
>
> Done means: unit tests for the finder and carousel logic, browser tests at desktop/tablet/phone in light
> and dark mode with axe, the translation check passing, and screenshots reviewed.

## Photo credits (Unsplash licence: free to use, credit appreciated)
Vitaly Gariev (family on the sofa, video call, father and son), Jan Baborák (working from home),
Florian Olivo (gaming), Compare Fibre (router). Downloaded to `frontend/public/home/` as WebP.
