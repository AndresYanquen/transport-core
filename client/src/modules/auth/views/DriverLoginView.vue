<script setup>
import { reactive } from "vue";
import { RouterLink } from "vue-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const form = reactive({
  countryCode: "+1-212",
  mobileNumber: "",
});

function setCode(code) {
  form.countryCode = code;
}
</script>

<template>
  <section class="min-h-screen bg-[#ffffff] flex items-center justify-center p-3">
    <div class="w-[375px] max-w-full min-h-[812px] bg-white px-1">
      <Card class="mx-4 mt-5 rounded-2xl border-none bg-[#f3f4f6] shadow-none">
        <CardContent class="px-4 pt-8 pb-4">
          <div class="flex items-center justify-center gap-2 text-[#202635]">
            <span class="text-sm">◎</span>
            <img class="text-[36px] font-extrabold leading-none tracking-tight" src="@/assets/images/logo/logo.png"></img>
          </div>

          <div class="mt-6 h-[2px] w-5 rounded bg-[#202635]"></div>

          <h1 class="mt-2 text-[20px] font-extrabold leading-[1.02] text-[#202635]">Bienvenido de nuevo!</h1>
          <p class="mt-1 text-[13px] font-medium text-[#727785]">Permitenos ayudarte.</p>

          <div class="mt-6">
            <Label for="driver-mobile" class="text-[12px] font-semibold text-[#202635]">Mobile Number</Label>

            <div class="mt-2 flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    type="button"
                    variant="outline"
                    class="h-11 w-[90px] justify-between rounded-[10px] border-[#d8dce4] bg-white px-3 text-[12px] font-semibold text-[#8a8f99] hover:bg-white"
                  >
                    {{ form.countryCode }}
                    <span class="text-[10px]">⌄</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" class="w-[80px]">
                  <DropdownMenuItem @select.prevent="setCode('+1-57')">+1-212</DropdownMenuItem>
                  <DropdownMenuItem @select.prevent="setCode('+1-213')">+1-213</DropdownMenuItem>
                  <DropdownMenuItem @select.prevent="setCode('+1-702')">+1-702</DropdownMenuItem>
                  <DropdownMenuItem @select.prevent="setCode('+1-312')">+1-312</DropdownMenuItem>
                  <DropdownMenuItem @select.prevent="setCode('+1-617')">+1-617</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Input
                id="driver-mobile"
                v-model.trim="form.mobileNumber"
                type="tel"
                inputmode="numeric"
                placeholder="Enter your number"
                class="h-11 flex-1 rounded-[10px] border-[#d8dce4] bg-white px-4 text-[10px] text-[#2d3440] placeholder:text-[#9aa0ab]"
              />
            </div>
          </div>

          <Button
            type="button"
            class="mt-6 h-11 w-full rounded-[10px] bg-[#111a2a] text-[13px] font-semibold text-white hover:bg-[#111a2a]/95"
          >
            Get OTP
          </Button>

          <p class="mt-4 text-center text-[12px] font-medium text-[#8b909a]">
            New User ?
            <RouterLink to="/signup" class="ml-1 font-bold text-[#202635]">Sign up</RouterLink>
          </p>

          <div class="my-4 flex items-center gap-3">
            <div class="h-px flex-1 bg-[#cdd2dc]"></div>
            <span class="text-[11px] font-semibold text-[#7a808c]">OR</span>
            <div class="h-px flex-1 bg-[#cdd2dc]"></div>
          </div>

          <Button
            type="button"
            variant="outline"
            class="h-11 w-full rounded-[10px] border-[#dfe3ea] bg-white text-[12px] font-semibold text-[#202635] hover:bg-white"
          >
            <span class="inline-grid size-4 place-items-center rounded-full border border-[#d2d5d8] text-[10px] font-extrabold text-[#4285f4]">G</span>
            Continue with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  </section>
</template>
